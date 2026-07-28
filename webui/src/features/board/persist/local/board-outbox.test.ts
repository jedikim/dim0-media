import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { asBatchId, asClientId } from "@canvas-harness/core"
import type { OpBatch } from "@canvas-harness/core"
import { engineCases } from "@/test/engines"
import type { StorageEngine } from "./engine"
import { BoardOutbox } from "./board-outbox"


const batch = (id: string, origin: "local" | "remote" | "history" = "local"): OpBatch => ({
  id: asBatchId(id),
  clientId: asClientId("c"),
  ts: 0,
  origin,
  ops: [],
})


// Seed an oplog entry directly (BoardPersistence normally does this).
const appendOp = (engine: StorageEngine, boardId: string, seq: number) =>
  engine.put("oplog", { boardId, seq, batch: batch(`${boardId}-${seq}`) })


for (const { label, make } of engineCases) describe(`BoardOutbox (${label})`, () => {
  let engine: StorageEngine


  beforeEach(async () => {
    engine = await make()
  })


  afterEach(() => {
    engine.close()
  })


  it("pending() is the whole oplog when nothing is synced", async () => {
    await appendOp(engine, "b", 1)
    await appendOp(engine, "b", 2)
    await appendOp(engine, "b", 3)
    const ob = new BoardOutbox(engine, "b")
    expect(await ob.syncedSeq()).toBe(0)
    expect((await ob.pending()).map((r) => r.seq)).toEqual([1, 2, 3])
  })


  it("markSyncedTo advances the cursor and shrinks pending()", async () => {
    await appendOp(engine, "b", 1)
    await appendOp(engine, "b", 2)
    await appendOp(engine, "b", 3)
    const ob = new BoardOutbox(engine, "b")

    await ob.markSyncedTo(2)
    expect(await ob.syncedSeq()).toBe(2)
    expect((await ob.pending()).map((r) => r.seq)).toEqual([3])
  })


  it("markSyncedTo never regresses the cursor", async () => {
    await appendOp(engine, "b", 1)
    const ob = new BoardOutbox(engine, "b")
    await ob.markSyncedTo(5)
    await ob.markSyncedTo(2) // stale/out-of-order ack
    expect(await ob.syncedSeq()).toBe(5)
  })


  it("pending() sends local + history but excludes remote (no echo)", async () => {
    // remote ops are recordRemote'd into the oplog and must NOT be sent back;
    // history (undo/redo) MUST be sent, same as the legacy client.
    await engine.put("oplog", { boardId: "b", seq: 1, batch: batch("l1", "local") })
    await engine.put("oplog", { boardId: "b", seq: 2, batch: batch("r1", "remote") })
    await engine.put("oplog", { boardId: "b", seq: 3, batch: batch("h1", "history") })
    const ob = new BoardOutbox(engine, "b")
    expect((await ob.pending()).map((r) => r.batch.id)).toEqual(["l1", "h1"])
  })


  it("the cursor is per board", async () => {
    await appendOp(engine, "a", 1)
    await appendOp(engine, "b", 1)
    await appendOp(engine, "b", 2)
    const oa = new BoardOutbox(engine, "a")
    const ob = new BoardOutbox(engine, "b")

    await oa.markSyncedTo(1)
    expect((await oa.pending()).map((r) => r.seq)).toEqual([])
    expect((await ob.pending()).map((r) => r.seq)).toEqual([1, 2]) // b untouched
  })
})
