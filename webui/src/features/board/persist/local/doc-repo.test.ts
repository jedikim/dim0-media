import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { engineCases } from "@/test/engines"
import type { StorageEngine } from "./engine"
import type { ChunkRecord, DocumentRecord } from "./idb"
import { DocRepo } from "./doc-repo"


const doc = (id: string, boardId: string, title = id): DocumentRecord => ({
  id,
  boardId,
  title,
  pages: 1,
  createdAt: 0,
})


const chunk = (chunkId: string, docId: string, boardId: string, index = 0): ChunkRecord => ({
  chunkId,
  docId,
  boardId,
  index,
  text: `text ${chunkId}`,
})


for (const { label, make } of engineCases) describe(`DocRepo (${label})`, () => {
  let engine: StorageEngine
  let repo: DocRepo


  beforeEach(async () => {
    engine = await make()
    repo = new DocRepo(engine)
  })


  afterEach(() => engine.close())


  it("round-trips a document and lists it per board", async () => {
    await repo.addDocument(doc("d1", "b1", "Report"))
    expect(await repo.getDocument("d1")).toMatchObject({ id: "d1", boardId: "b1", title: "Report" })
    expect((await repo.listDocuments("b1")).map((d) => d.id)).toEqual(["d1"])
  })


  it("scopes listDocuments to the board (no cross-board leakage)", async () => {
    await repo.addDocument(doc("d1", "b1"))
    await repo.addDocument(doc("d2", "b2"))
    expect((await repo.listDocuments("b1")).map((d) => d.id)).toEqual(["d1"])
    expect((await repo.listDocuments("b2")).map((d) => d.id)).toEqual(["d2"])
    expect(await repo.listDocuments("nope")).toEqual([])
  })


  it("stores + reads chunks by board and by doc", async () => {
    await repo.addChunks([
      chunk("d1#0", "d1", "b1", 0),
      chunk("d1#1", "d1", "b1", 1),
      chunk("d2#0", "d2", "b1", 0),
    ])
    expect((await repo.chunksForBoard("b1")).length).toBe(3) // whole board → rebuild index
    expect((await repo.chunksForDoc("d1")).map((c) => c.chunkId).sort()).toEqual(["d1#0", "d1#1"])
    expect((await repo.chunksForDoc("d2")).map((c) => c.chunkId)).toEqual(["d2#0"])
  })


  it("addChunks([]) is a no-op", async () => {
    await repo.addChunks([])
    expect(await repo.chunksForBoard("b1")).toEqual([])
  })


  it("findByTitle returns the board's doc with that exact title, else undefined", async () => {
    await repo.addDocument(doc("d1", "b1", "Report.pdf"))
    await repo.addDocument(doc("d2", "b2", "Report.pdf")) // same title, different board
    expect((await repo.findByTitle("b1", "Report.pdf"))?.id).toBe("d1")
    expect((await repo.findByTitle("b2", "Report.pdf"))?.id).toBe("d2") // scoped per board
    expect(await repo.findByTitle("b1", "Missing.pdf")).toBeUndefined()
    expect(await repo.findByTitle("b1", "report.pdf")).toBeUndefined() // exact match, case-sensitive
  })


  it("replaceDocument upserts the doc and replaces exactly its chunks", async () => {
    await repo.replaceDocument(doc("d1", "b1", "R"), [chunk("d1#0", "d1", "b1", 0), chunk("d1#1", "d1", "b1", 1)])
    await repo.addChunks([chunk("d2#0", "d2", "b1")]) // an unrelated doc's chunk

    // Re-ingest d1 with fewer chunks (override): old d1 chunks gone, d2 untouched.
    await repo.replaceDocument({ ...doc("d1", "b1", "R"), pages: 9 }, [chunk("d1#0", "d1", "b1", 0)])

    expect((await repo.getDocument("d1"))?.pages).toBe(9) // metadata updated in place
    expect((await repo.chunksForDoc("d1")).map((c) => c.chunkId)).toEqual(["d1#0"]) // replaced, not appended
    expect((await repo.chunksForDoc("d2")).map((c) => c.chunkId)).toEqual(["d2#0"]) // untouched
  })


  it("replaceDocument works as a fresh insert when the doc is new", async () => {
    await repo.replaceDocument(doc("d9", "b1", "New"), [chunk("d9#0", "d9", "b1")])
    expect((await repo.getDocument("d9"))?.title).toBe("New")
    expect((await repo.chunksForDoc("d9")).length).toBe(1)
  })


  it("deleteDocument removes the doc + its chunks, leaving other docs intact", async () => {
    await repo.addDocument(doc("d1", "b1"))
    await repo.addDocument(doc("d2", "b1"))
    await repo.addChunks([chunk("d1#0", "d1", "b1"), chunk("d1#1", "d1", "b1", 1), chunk("d2#0", "d2", "b1")])

    await repo.deleteDocument("d1")

    expect(await repo.getDocument("d1")).toBeUndefined()
    expect(await repo.chunksForDoc("d1")).toEqual([])
    expect((await repo.listDocuments("b1")).map((d) => d.id)).toEqual(["d2"]) // d2 survives
    expect((await repo.chunksForDoc("d2")).map((c) => c.chunkId)).toEqual(["d2#0"]) // d2 chunks survive
  })
})
