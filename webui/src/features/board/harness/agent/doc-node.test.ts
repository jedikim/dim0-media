import { beforeEach, describe, expect, it } from "vitest"
import { asNodeId } from "@canvas-harness/core"
import { addNode, freshStore, resetIdb } from "@/test/canvas"
import { addDocumentNode } from "./doc-node"


beforeEach(() => resetIdb())


const titleOf = (store: ReturnType<typeof freshStore>, id: string): string | undefined =>
  (store.getNode(asNodeId(id))?.data as { label?: { markdown?: string } } | undefined)?.label?.markdown


describe("addDocumentNode", () => {
  it("adds a 'document' node whose id is the docId, carrying the title", () => {
    const store = freshStore("c")
    addDocumentNode(store, { docId: "d1", title: "Report.pdf", boardId: "b1" })
    const node = store.getNode(asNodeId("d1"))
    expect(node?.type).toBe("document")
    expect(titleOf(store, "d1")).toBe("Report.pdf")
  })

  it("places the node beneath existing board content", () => {
    const store = freshStore("c")
    addNode(store, "old")
    store.updateNode(asNodeId("old"), { x: 0, y: 100, w: 200, h: 120 }) // bottom 220
    addDocumentNode(store, { docId: "d1", title: "A.pdf", boardId: "b1" })
    expect(store.getNode(asNodeId("d1"))!.y).toBeGreaterThanOrEqual(220)
  })

  it("is a no-op when a node with that id already exists (override reuses the id)", () => {
    const store = freshStore("c")
    addDocumentNode(store, { docId: "d1", title: "A.pdf", boardId: "b1" })
    const y0 = store.getNode(asNodeId("d1"))!.y
    addDocumentNode(store, { docId: "d1", title: "A.pdf", boardId: "b1" })
    expect(store.getAllNodes().filter((n) => String(n.id) === "d1")).toHaveLength(1) // no duplicate
    expect(store.getNode(asNodeId("d1"))!.y).toBe(y0) // untouched
  })

  it("creates the node WITHOUT putting it on the undo stack (non-undoable)", () => {
    const store = freshStore("c")
    store.clearHistory()
    addDocumentNode(store, { docId: "d1", title: "A.pdf", boardId: "b1" })
    expect(store.getNode(asNodeId("d1"))).toBeDefined()
    store.undo() // history-origin create is off the stack — must not remove it
    expect(store.getNode(asNodeId("d1"))).toBeDefined()
  })

  it("stamps the current folder layer (parentId) when a rootId is given", () => {
    const store = freshStore("c")
    addDocumentNode(store, { docId: "d1", title: "A.pdf", boardId: "b1", rootId: "folder-1" })
    expect((store.getNode(asNodeId("d1"))?.data as { parentId?: string }).parentId).toBe("folder-1")
  })
})
