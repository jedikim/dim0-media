import { beforeEach, describe, expect, it } from "vitest"
import type { Node, Op, OpBatch } from "@canvas-harness/core"
import { resetIdb } from "@/test/canvas"
import { getLocalStores } from "@/features/local-stores"
import { cascadeRemovedDocs, removedDocNodeIds } from "./use-doc-node-cascade"


const node = (id: string, type: string): Node => ({ id, type } as unknown as Node)
const removeOp = (id: string, type: string): Op => ({ type: "node.remove", node: node(id, type) } as unknown as Op)
const addOp = (id: string): Op => ({ type: "node.add", node: node(id, "document") } as unknown as Op)


const batch = (origin: OpBatch["origin"], ops: Op[]): OpBatch =>
  ({ id: "b", clientId: "c", ts: 0, origin, ops } as unknown as OpBatch)


describe("removedDocNodeIds", () => {
  it("returns the ids of removed document nodes on a genuine (local) edit", () => {
    expect(
      removedDocNodeIds(batch("local", [removeOp("d1", "document"), removeOp("n1", "rect")])),
    ).toEqual(["d1"])
  })

  it("collects multiple removed document nodes", () => {
    expect(
      removedDocNodeIds(batch("local", [removeOp("d1", "document"), removeOp("d2", "document")])),
    ).toEqual(["d1", "d2"])
  })

  it("cascades history-origin removals — durable doc/folder deletes are non-undoable (history)", () => {
    // removeNodeSubtree applies a durable-type delete as a `history` batch; the
    // DocRepo cleanup MUST still run, and a folder delete carries its child
    // document's node.remove in the same batch.
    expect(
      removedDocNodeIds(batch("history", [removeOp("folder-1", "folder"), removeOp("d1", "document")])),
    ).toEqual(["d1"])
  })

  it("IGNORES remote-origin batches — a hydrate/clear must never cascade-delete docs", () => {
    // applyContentToStore clears the scene as a `remote` batch on reload / layer
    // switch; treating that as a delete would wipe every document.
    expect(removedDocNodeIds(batch("remote", [removeOp("d1", "document")]))).toEqual([])
  })

  it("ignores non-remove ops and non-document node removals", () => {
    expect(removedDocNodeIds(batch("local", [addOp("d1"), removeOp("n1", "rect"), removeOp("n2", "sheet")]))).toEqual([])
  })
})


describe("cascadeRemovedDocs", () => {
  beforeEach(() => resetIdb())

  it("deletes each document and its chunks from local storage", async () => {
    const { docs } = await getLocalStores()
    await docs.addDocument({ id: "d1", boardId: "b", title: "A.pdf", pages: 1, createdAt: 0 })
    await docs.addChunks([{ chunkId: "d1#0", docId: "d1", boardId: "b", index: 0, text: "hello" }])

    await cascadeRemovedDocs("b", ["d1"])

    expect(await docs.getDocument("d1")).toBeUndefined()
    expect(await docs.chunksForDoc("d1")).toEqual([])
  })

  it("leaves other documents untouched", async () => {
    const { docs } = await getLocalStores()
    await docs.addDocument({ id: "d1", boardId: "b", title: "A.pdf", pages: 1, createdAt: 0 })
    await docs.addDocument({ id: "d2", boardId: "b", title: "B.pdf", pages: 1, createdAt: 0 })

    await cascadeRemovedDocs("b", ["d1"])

    expect(await docs.getDocument("d1")).toBeUndefined()
    expect(await docs.getDocument("d2")).toBeDefined()
  })

  it("is a no-op for an empty id list", async () => {
    const { docs } = await getLocalStores()
    await docs.addDocument({ id: "d1", boardId: "b", title: "A.pdf", pages: 1, createdAt: 0 })
    await cascadeRemovedDocs("b", [])
    expect(await docs.getDocument("d1")).toBeDefined()
  })
})
