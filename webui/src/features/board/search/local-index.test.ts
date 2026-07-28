import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { asNodeId } from "@canvas-harness/core"
import { addNode, freshStore } from "@/test/canvas"
import { LocalSearchIndex } from "./local-index"


describe("LocalSearchIndex", () => {
  it("finds a node by its title", async () => {
    const store = freshStore("c")
    const index = new LocalSearchIndex()
    index.attach(store)

    addNode(store, "n1", "hello world")
    await index.idle()

    expect(await index.query("hello")).toContain("n1")
    expect(await index.query("nonexistent")).toHaveLength(0)
  })


  it("does not crash when a node's label is not a string", async () => {
    const store = freshStore("c")
    const index = new LocalSearchIndex()
    index.attach(store)

    addNode(store, "n1", "ok")
    await index.idle()
    expect(await index.query("ok")).toContain("n1")

    // A node type puts a non-string in data.label — must not reject the insert
    // (which would otherwise poison the whole update queue).
    store.updateNode(asNodeId("n1"), {
      data: { label: { markdown: "x" } as unknown as string, meta: { v: 1, createdAt: 0, updatedAt: 0 } },
    })
    await index.idle()

    expect(index.count()).toBe(1) // still indexed, just no title text
    expect(await index.query("ok")).toHaveLength(0) // old title dropped on upsert

    // The queue still works for later nodes.
    addNode(store, "n2", "later")
    await index.idle()
    expect(await index.query("later")).toContain("n2")
  })


  it("reflects updates: changed body becomes searchable, old text does not", async () => {
    const store = freshStore("c")
    const index = new LocalSearchIndex()
    index.attach(store)

    addNode(store, "n1")
    store.updateNode(asNodeId("n1"), { content: "alpha" })
    await index.idle()
    expect(await index.query("alpha")).toContain("n1")

    store.updateNode(asNodeId("n1"), { content: "beta" })
    await index.idle()
    expect(await index.query("alpha")).toHaveLength(0)
    expect(await index.query("beta")).toContain("n1")
  })


  it("removes a node from the index", async () => {
    const store = freshStore("c")
    const index = new LocalSearchIndex()
    index.attach(store)

    addNode(store, "n1", "findme")
    await index.idle()
    expect(index.count()).toBe(1)

    store.removeNode(asNodeId("n1"))
    await index.idle()
    expect(index.count()).toBe(0)
    expect(await index.query("findme")).toHaveLength(0)
  })


  it("INV-9 fuzz: index id-set always equals the store's, incremental == rebuild", async () => {
    await fc.assert(
      fc.asyncProperty(arbActions(), async (actions) => {
        const store = freshStore("c")
        const index = new LocalSearchIndex()
        index.attach(store)
        const ids: string[] = []
        let counter = 0

        for (const a of actions) {
          if (a.kind === "add") {
            const id = `n${counter++}`
            addNode(store, id, a.label)
            ids.push(id)
          } else if (a.kind === "update" && ids.length > 0) {
            store.updateNode(asNodeId(ids[a.idx % ids.length]!), { content: a.text })
          } else if (a.kind === "remove" && ids.length > 0) {
            const i = a.idx % ids.length
            store.removeNode(asNodeId(ids[i]!))
            ids.splice(i, 1)
          }
        }
        await index.idle()

        // incremental index matches the store exactly
        expect(index.count()).toBe(store.getAllNodes().length)
        for (const id of ids) expect(index.has(id)).toBe(true)

        // a full rebuild produces the same id-set
        await index.rebuildFromStore(store)
        expect(index.count()).toBe(store.getAllNodes().length)
        for (const id of ids) expect(index.has(id)).toBe(true)
      }),
      { numRuns: 40 },
    )
  })
})


const arbActions = () =>
  fc.array(
    fc.oneof(
      fc.record({ kind: fc.constant("add" as const), label: fc.string() }),
      fc.record({ kind: fc.constant("update" as const), idx: fc.nat(), text: fc.string() }),
      fc.record({ kind: fc.constant("remove" as const), idx: fc.nat() }),
    ),
    { maxLength: 40 },
  )
