import { beforeEach, describe, expect, it } from "vitest"
import fc from "fast-check"
import { asNodeId } from "@canvas-harness/core"
import type { OpBatch } from "@canvas-harness/core"
import { addEdge, addNode, comparable, freshStore, resetIdb } from "@/test/canvas"
import { BoardPersistence } from "./board-persistence"
import { contentToScene, readContent } from "./codec"


beforeEach(() => {
  resetIdb()
})


/** Capture a valid OpBatch from a throwaway store, retagged as a relay `remote` op. */
const captureRemoteBatch = (mutate: (s: ReturnType<typeof freshStore>) => void): OpBatch => {
  const s = freshStore("peer")
  let captured: OpBatch | undefined
  const unsub = s.subscribe("change", (b) => {
    captured = b
  })
  mutate(s)
  unsub()
  if (!captured) throw new Error("no batch captured")
  return { ...captured, origin: "remote" }
}


/** Test double: a compaction that crashes before any write commits. */
class CrashOnCompact extends BoardPersistence {
  protected async writeSnapshot(): Promise<void> {
    throw new Error("simulated crash")
  }
}


describe("BoardPersistence", () => {
  it("INV-1 durability: a committed batch survives a fresh load", async () => {
    const p = new BoardPersistence("b")
    await p.init()
    const store = freshStore("c")
    p.attach(store)

    addNode(store, "n1", "hello")
    await p.flush()

    const content = await p.load()
    expect(content.nodes.map((n) => n.id)).toContain("n1")
    expect((content.nodes[0]?.data)?.label).toBe("hello")
    p.close()
  })


  it("recordRemote persists relay ops so a reload includes remote edits", async () => {
    const p = new BoardPersistence("b")
    await p.init()
    const store = freshStore("c")
    p.attach(store)

    addNode(store, "local1") // a local edit (recorded via the attach path)
    p.recordRemote(captureRemoteBatch((s) => addNode(s, "remote1", "from peer")))
    await p.flush()

    const content = await p.load()
    expect(content.nodes.map((n) => n.id).sort()).toEqual(["local1", "remote1"])
    p.close()
  })


  // --- offline base for synced boards (foldBase) ---
  // The base is written by `materializeBoardOffline` via `foldBase` (its guards —
  // snapshot-exists / unsent-local / oplog-stable — are covered in
  // materialize-board.test.ts). Here we cover the primitive's replay contract.

  /** A server-only base, as `graphToContent(welcome)` would produce. */
  const serverBase = (...ids: string[]) => {
    const s = freshStore("srv")
    for (const id of ids) addNode(s, id)
    return readContent(s)
  }

  it("foldBase seeds a base so a synced board loads offline", async () => {
    const p = new BoardPersistence("b")
    await p.init()
    await p.foldBase(serverBase("s1", "s2"), 0)
    p.close()

    // Next session / offline: a fresh instance loads the persisted base.
    const p2 = new BoardPersistence("b")
    await p2.init()
    const content = await p2.load()
    expect(content.nodes.map((n) => n.id).sort()).toEqual(["s1", "s2"])
    p2.close()
  })

  it("edits above the fold seq replay on top of the base (serverSeq order)", async () => {
    const p = new BoardPersistence("b")
    await p.init()
    await p.foldBase(serverBase("s1"), 0) // base at seq 0 → later ops replay on top
    await p.load() // sync the seq cursor to the base

    const store = freshStore("c")
    p.attach(store)
    addNode(store, "local1") // unacked local (no serverSeq) → sorts last
    p.recordRemote(captureRemoteBatch((s) => addNode(s, "remote1")), 10)
    await p.flush()

    const content = await p.load()
    expect(content.nodes.map((n) => n.id).sort()).toEqual(["local1", "remote1", "s1"])
    p.close()
  })


  it("INV-2 reconstruction: load() reproduces the live store exactly", async () => {
    const p = new BoardPersistence("b")
    await p.init()
    const store = freshStore("c")
    p.attach(store)

    addNode(store, "n1")
    addNode(store, "n2")
    store.updateNode(asNodeId("n1"), { x: 42 })
    store.removeNode(asNodeId("n2"))
    await p.flush()

    expect(comparable(await p.load())).toEqual(comparable(readContent(store)))
    p.close()
  })


  it("INV-3 snapshot-equiv: compact() does not change content", async () => {
    const p = new BoardPersistence("b")
    await p.init()
    const store = freshStore("c")
    p.attach(store)

    addNode(store, "n1")
    addNode(store, "n2")
    store.updateNode(asNodeId("n1"), { x: 7 })
    await p.flush()

    const before = comparable(await p.load())
    await p.compact()
    expect(comparable(await p.load())).toEqual(before)
    p.close()
  })


  it("INV-4 idempotency: re-recording the same batch is a no-op", async () => {
    const store = freshStore("c")
    let captured: OpBatch | undefined
    const unsub = store.subscribe("change", (b) => {
      captured = b
    })
    addNode(store, "n1")
    unsub()

    const p = new BoardPersistence("b")
    await p.init()
    p.record(captured!)
    p.record(captured!) // duplicate
    await p.flush()

    const content = await p.load()
    expect(content.nodes.filter((n) => n.id === "n1")).toHaveLength(1)
    p.close()
  })


  it("INV-5 crash-safety: a failed compaction leaves prior state intact", async () => {
    const p = new CrashOnCompact("b")
    await p.init()
    const store = freshStore("c")
    p.attach(store)
    addNode(store, "n1")
    addNode(store, "n2")
    await p.flush()

    const before = comparable(await p.load())
    await expect(p.compact()).rejects.toThrow("simulated crash")
    expect(comparable(await p.load())).toEqual(before) // rolled back
    p.close()

    // recovery: a normal instance on the same db compacts cleanly
    const p2 = new BoardPersistence("b")
    await p2.init()
    await p2.compact()
    expect(comparable(await p2.load())).toEqual(before)
    p2.close()
  })


  it("INV-6 isolation: boards don't bleed into each other", async () => {
    const pa = new BoardPersistence("a")
    await pa.init()
    const pb = new BoardPersistence("b")
    await pb.init()
    const sa = freshStore("ca")
    pa.attach(sa)
    const sb = freshStore("cb")
    pb.attach(sb)

    addNode(sa, "a1")
    addNode(sb, "b1")
    addNode(sa, "a2")
    await pa.flush()
    await pb.flush()

    expect((await pa.load()).nodes.map((n) => n.id).sort()).toEqual(["a1", "a2"])
    expect((await pb.load()).nodes.map((n) => n.id)).toEqual(["b1"])
    pa.close()
    pb.close()
  })


  it("INV-2/3 fuzz: random ops (nodes + edges) + reload/compact reconverge", async () => {
    await fc.assert(
      fc.asyncProperty(arbActions(), async (actions) => {
        resetIdb()
        const p = new BoardPersistence("b")
        await p.init()
        // Each store instance gets a UNIQUE clientId — batch ids are
        // `clientId + counter`, so reusing a clientId across reloads would
        // collide ids and trip dedup. Production uses a fresh random clientId
        // per load, which the board lifecycle (A2) must preserve.
        let clientN = 0
        let store = freshStore(`c${clientN++}`)
        let unsub = p.attach(store)
        const ids: string[] = []
        let nodeCounter = 0
        let edgeCounter = 0

        for (const a of actions) {
          if (a.kind === "add") {
            const id = `n${nodeCounter++}`
            addNode(store, id, a.label)
            ids.push(id)
          } else if (a.kind === "addEdge" && ids.length >= 2) {
            addEdge(store, `e${edgeCounter++}`, ids[a.s % ids.length], ids[a.t % ids.length])
          } else if (a.kind === "update" && ids.length > 0) {
            store.updateNode(asNodeId(ids[a.idx % ids.length]), { x: a.x })
          } else if (a.kind === "remove" && ids.length > 0) {
            const i = a.idx % ids.length
            store.removeNode(asNodeId(ids[i]))
            ids.splice(i, 1)
          } else if (a.kind === "reload") {
            await p.flush()
            const before = comparable(readContent(store))
            unsub()
            const content = await p.load()
            expect(comparable(content)).toEqual(before)
            store = freshStore(`c${clientN++}`, contentToScene(content))
            unsub = p.attach(store)
          } else if (a.kind === "compact") {
            await p.flush()
            const before = comparable(readContent(store))
            await p.compact()
            expect(comparable(await p.load())).toEqual(before)
          }
        }

        await p.flush()
        expect(comparable(await p.load())).toEqual(comparable(readContent(store)))
        p.close()
      }),
      { numRuns: 50 },
    )
  })
})


const arbActions = () =>
  fc.array(
    fc.oneof(
      fc.record({ kind: fc.constant("add" as const), label: fc.string() }),
      fc.record({ kind: fc.constant("addEdge" as const), s: fc.nat(), t: fc.nat() }),
      fc.record({ kind: fc.constant("update" as const), idx: fc.nat(), x: fc.integer({ min: -1000, max: 1000 }) }),
      fc.record({ kind: fc.constant("remove" as const), idx: fc.nat() }),
      fc.constant({ kind: "reload" as const }),
      fc.constant({ kind: "compact" as const }),
    ),
    { maxLength: 50 },
  )
