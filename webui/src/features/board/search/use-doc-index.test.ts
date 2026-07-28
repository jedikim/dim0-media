import { beforeEach, describe, expect, it } from "vitest"
import { resetIdb } from "@/test/canvas"
import { getLocalStores } from "@/features/local-stores"
import { DocChunkIndex } from "./doc-index"
import { setDocIndexRef } from "./doc-index-ref"
import { rebuildDocIndex, refreshDocIndex } from "./use-doc-index"


beforeEach(() => resetIdb())


const seed = async (): Promise<void> => {
  const { docs } = await getLocalStores()
  await docs.addDocument({ id: "d1", boardId: "b1", title: "Report", pages: 1, createdAt: 0 })
  await docs.addChunks([
    { chunkId: "d1#0", docId: "d1", boardId: "b1", index: 0, text: "Q3 revenue grew 20%." },
    { chunkId: "d1#1", docId: "d1", boardId: "b1", index: 1, text: "Headcount stayed flat." },
  ])
  // A different board's doc must not leak into b1's index.
  await docs.addDocument({ id: "d2", boardId: "b2", title: "Other", pages: 1, createdAt: 0 })
  await docs.addChunks([{ chunkId: "d2#0", docId: "d2", boardId: "b2", index: 0, text: "revenue elsewhere" }])
}


describe("rebuildDocIndex", () => {
  it("indexes a board's chunks joined to their document title (for citations)", async () => {
    await seed()
    const index = new DocChunkIndex()
    await rebuildDocIndex(index, "b1")
    expect(index.count()).toBe(2) // only b1's chunks
    const hits = await index.query("revenue")
    expect(hits[0]).toMatchObject({ chunkId: "d1#0", docId: "d1", docTitle: "Report" })
  })

  it("scopes strictly to the board (no cross-board leakage)", async () => {
    await seed()
    const index = new DocChunkIndex()
    await rebuildDocIndex(index, "b1")
    // "revenue elsewhere" (b2) must not be reachable through b1's index.
    expect((await index.query("elsewhere"))).toEqual([])
  })
})


describe("refreshDocIndex", () => {
  it("rebuilds the active (ref) index for the board, ignoring when no index is mounted", async () => {
    await refreshDocIndex("b1") // no ref set → no throw
    await seed()
    const index = new DocChunkIndex()
    setDocIndexRef(index)
    await refreshDocIndex("b1")
    expect(index.count()).toBe(2)
    setDocIndexRef(null)
  })
})
