import { describe, expect, it } from "vitest"
import { DocChunkIndex, type ChunkDoc } from "./doc-index"


const chunk = (chunkId: string, text: string, docId = "d1", docTitle = "Doc 1"): ChunkDoc => ({
  chunkId,
  docId,
  docTitle,
  text,
})


describe("DocChunkIndex", () => {
  it("returns matching chunks with their doc metadata (for citations)", async () => {
    const index = new DocChunkIndex()
    await index.rebuild([
      chunk("c0", "Napoleon was crowned Emperor in 1804.", "d1", "History"),
      chunk("c1", "Photosynthesis converts light into chemical energy.", "d2", "Biology"),
    ])
    const hits = await index.query("emperor napoleon")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]).toMatchObject({ chunkId: "c0", docId: "d1", docTitle: "History" })
    expect(hits[0].text).toContain("Napoleon")
  })

  it("counts indexed chunks and treats a blank query as no results", async () => {
    const index = new DocChunkIndex()
    await index.rebuild([chunk("c0", "alpha"), chunk("c1", "beta")])
    expect(index.count()).toBe(2)
    expect(await index.query("   ")).toEqual([])
  })

  it("rebuild replaces the previous contents", async () => {
    const index = new DocChunkIndex()
    await index.rebuild([chunk("c0", "alpha unique-old")])
    await index.rebuild([chunk("c1", "beta unique-new")])
    expect(index.count()).toBe(1)
    expect(await index.query("unique-old")).toEqual([])
    expect((await index.query("unique-new"))[0]?.chunkId).toBe("c1")
  })

  it("an empty index yields no hits", async () => {
    expect(await new DocChunkIndex().query("anything")).toEqual([])
  })
})
