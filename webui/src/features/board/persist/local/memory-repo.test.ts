import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { engineCases } from "@/test/engines"
import type { StorageEngine } from "./engine"
import { BOARD_MEM_CHARS, MemoryRepo, memoryBucket, memoryHash } from "./memory-repo"


const addArgs = (over: Partial<Parameters<MemoryRepo["add"]>[0]> = {}) => ({
  scope: "board" as const,
  boardId: "b1",
  kind: "project" as const,
  title: "t",
  summary: "s",
  body: "the fact",
  id: "m1",
  now: 1,
  ...over,
})


for (const { label, make } of engineCases) describe(`MemoryRepo (${label})`, () => {
  let engine: StorageEngine
  let repo: MemoryRepo


  beforeEach(async () => {
    engine = await make()
    repo = new MemoryRepo(engine)
  })


  afterEach(() => engine.close())


  it("adds and lists a board memory, oldest first", async () => {
    await repo.add(addArgs({ id: "m1", body: "first", now: 1 }))
    await repo.add(addArgs({ id: "m2", body: "second", now: 2 }))
    const list = await repo.list("board", "b1")
    expect(list.map((r) => r.id)).toEqual(["m1", "m2"])
    expect(list[0].bucket).toBe("board:b1")
  })


  it("isolates scopes: board A, board B, and global never bleed", async () => {
    await repo.add(addArgs({ id: "a", boardId: "A", body: "fact a" }))
    await repo.add(addArgs({ id: "b", boardId: "B", body: "fact b" }))
    await repo.add(addArgs({ id: "g", scope: "global", boardId: null, body: "fact g" }))
    expect((await repo.list("board", "A")).map((r) => r.id)).toEqual(["a"])
    expect((await repo.list("board", "B")).map((r) => r.id)).toEqual(["b"])
    expect((await repo.list("global", null)).map((r) => r.id)).toEqual(["g"])
  })


  it("stores a global memory with boardId null and the global bucket", async () => {
    const res = await repo.add(addArgs({ id: "g", scope: "global", boardId: "ignored", body: "x" }))
    expect(res.ok).toBe(true)
    const [rec] = await repo.list("global", null)
    expect(rec.boardId).toBe(null)
    expect(rec.bucket).toBe(memoryBucket("global", null))
  })


  it("dedups by normalized body hash (returns the existing record, no duplicate)", async () => {
    const first = await repo.add(addArgs({ id: "m1", body: "Remember this" }))
    const dup = await repo.add(addArgs({ id: "m2", body: "  remember   THIS " }))
    expect(first.ok && dup.ok).toBe(true)
    if (dup.ok) expect(dup.record.id).toBe("m1") // the pre-existing one, not m2
    expect((await repo.list("board", "b1")).length).toBe(1)
  })


  it("rejects a write over the char cap and returns current entries without writing", async () => {
    await repo.add(addArgs({ id: "big", body: "x".repeat(BOARD_MEM_CHARS - 10) }))
    const res = await repo.add(addArgs({ id: "overflow", body: "y".repeat(100) }))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe("over_cap")
      expect(res.entries.map((r) => r.id)).toEqual(["big"])
    }
    expect((await repo.list("board", "b1")).map((r) => r.id)).toEqual(["big"]) // overflow not written
  })


  it("soft-deletes: a tombstoned record drops from list but persists underneath", async () => {
    await repo.add(addArgs({ id: "m1", body: "gone soon" }))
    await repo.remove("m1", 5)
    expect(await repo.list("board", "b1")).toEqual([])
    const raw = await engine.get<{ deleted?: boolean }>("memories", "m1")
    expect(raw?.deleted).toBe(true)
  })


  it("update re-hashes when the body changes (so dedup tracks the new text)", async () => {
    await repo.add(addArgs({ id: "m1", body: "old body" }))
    await repo.update("m1", { body: "new body" }, 9)
    const [rec] = await repo.list("board", "b1")
    expect(rec.body).toBe("new body")
    expect(rec.hash).toBe(memoryHash("new body"))
    expect(rec.updatedAt).toBe(9)
  })


  it("charCount sums live records only", async () => {
    await repo.add(addArgs({ id: "m1", title: "ab", summary: "cd", body: "ef" })) // 2+2+2 = 6
    await repo.remove("m1", 2)
    expect(await repo.charCount("board", "b1")).toBe(0)
  })


  it("update enforces the char cap (a grow that would overflow is rejected)", async () => {
    await repo.add(addArgs({ id: "m1", body: "small" }))
    const res = await repo.update("m1", { body: "z".repeat(BOARD_MEM_CHARS + 1) }, 5)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe("over_cap")
    expect((await repo.list("board", "b1"))[0].body).toBe("small") // unchanged
  })


  it("update reports not_found for an unknown or tombstoned id", async () => {
    expect(await repo.update("ghost", { body: "x" }, 1)).toEqual({ ok: false, reason: "not_found" })
    await repo.add(addArgs({ id: "m1", body: "x" }))
    await repo.remove("m1", 2)
    expect(await repo.update("m1", { body: "y" }, 3)).toEqual({ ok: false, reason: "not_found" })
  })


  it("remove reports whether anything changed", async () => {
    await repo.add(addArgs({ id: "m1", body: "x" }))
    expect(await repo.remove("m1", 2)).toBe(true)
    expect(await repo.remove("m1", 3)).toBe(false) // already tombstoned
    expect(await repo.remove("ghost", 4)).toBe(false)
  })
})
