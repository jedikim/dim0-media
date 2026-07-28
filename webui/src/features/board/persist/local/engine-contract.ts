/**
 * StorageEngine port contract — behavioural tests written against the interface,
 * not any implementation. Run it against every `StorageEngine` (IndexedDb now,
 * an in-memory double, a future SQLite adapter) so they all behave identically.
 *
 * `makeEngine` must return a FRESH, EMPTY engine each call.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { KeyRange, StorageEngine } from "./engine"


const board = (id: string, title = id) => ({ id, title })
const chat = (id: string, boardId: string, updatedAt = 0) => ({ id, boardId, updatedAt })
const oplog = (boardId: string, seq: number) => ({ boardId, seq, batch: { id: `${boardId}-${seq}` } })


export const runEngineContract = (label: string, makeEngine: () => Promise<StorageEngine>): void => {
  describe(`StorageEngine contract — ${label}`, () => {
    let e: StorageEngine

    beforeEach(async () => {
      e = await makeEngine()
    })

    afterEach(() => {
      e.close()
    })


    it("round-trips a value on a key-path store", async () => {
      await e.put("boards", board("b1", "Hello"))
      expect(await e.get("boards", "b1")).toEqual(board("b1", "Hello"))
    })


    it("returns undefined for a missing key", async () => {
      expect(await e.get("boards", "nope")).toBeUndefined()
    })


    it("round-trips with an explicit (out-of-line) key", async () => {
      const view = { camera: { x: 1, y: 2, z: 3 }, selection: [] }
      await e.put("views", view, "b1")
      expect(await e.get("views", "b1")).toEqual(view)
    })


    it("put replaces an existing value", async () => {
      await e.put("boards", board("b1", "one"))
      await e.put("boards", board("b1", "two"))
      expect(await e.get<{ title: string }>("boards", "b1")).toMatchObject({ title: "two" })
    })


    it("lists every value in a store", async () => {
      await e.put("boards", board("b1"))
      await e.put("boards", board("b2"))
      const all = await e.list<{ id: string }>("boards")
      expect(all.map((b) => b.id).sort()).toEqual(["b1", "b2"])
    })


    it("lists in reverse key order when order=desc", async () => {
      await e.put("boards", board("b1"))
      await e.put("boards", board("b2"))
      await e.put("boards", board("b3"))
      const desc = await e.list<{ id: string }>("boards", { order: "desc" })
      expect(desc.map((b) => b.id)).toEqual(["b3", "b2", "b1"])
    })


    it("lists a compound-key range", async () => {
      await e.put("oplog", oplog("a", 1))
      await e.put("oplog", oplog("a", 2))
      await e.put("oplog", oplog("b", 1))
      const range: KeyRange = { lower: ["a", 0], upper: ["a", Number.MAX_SAFE_INTEGER] }
      const rows = await e.list<{ seq: number }>("oplog", { range })
      expect(rows.map((r) => r.seq)).toEqual([1, 2])
    })


    it("honours an open lower bound on a compound range", async () => {
      await e.put("oplog", oplog("a", 1))
      await e.put("oplog", oplog("a", 2))
      await e.put("oplog", oplog("a", 3))
      // Exclude seq 1 via lowerOpen (mirrors BoardPersistence tail replay).
      const rows = await e.list<{ seq: number }>("oplog", {
        range: { lower: ["a", 1], upper: ["a", Number.MAX_SAFE_INTEGER], lowerOpen: true },
      })
      expect(rows.map((r) => r.seq)).toEqual([2, 3])
    })


    it("lists via a secondary index", async () => {
      await e.put("chats", chat("c1", "board-a"))
      await e.put("chats", chat("c2", "board-b"))
      await e.put("chats", chat("c3", "board-a"))
      const rows = await e.list<{ id: string }>("chats", {
        index: "by-board",
        range: { lower: "board-a", upper: "board-a" },
      })
      expect(rows.map((r) => r.id).sort()).toEqual(["c1", "c3"])
    })


    it("deletes a single key", async () => {
      await e.put("boards", board("b1"))
      await e.delete("boards", "b1")
      expect(await e.get("boards", "b1")).toBeUndefined()
    })


    it("deletes every key in a range", async () => {
      await e.put("oplog", oplog("a", 1))
      await e.put("oplog", oplog("a", 2))
      await e.put("oplog", oplog("b", 1))
      await e.delete("oplog", { lower: ["a", 0], upper: ["a", Number.MAX_SAFE_INTEGER] })
      expect(await e.list("oplog")).toHaveLength(1) // only ["b", 1] remains
    })


    it("commits a multi-store transaction atomically and returns the callback value", async () => {
      const n = await e.tx(["boards", "views"], async (t) => {
        await t.put("boards", board("b1"))
        await t.put("views", { camera: { x: 0, y: 0, z: 1 }, selection: [] }, "b1")
        return 42
      })
      expect(n).toBe(42)
      expect(await e.get("boards", "b1")).toBeDefined()
      expect(await e.get("views", "b1")).toBeDefined()
    })


    it("rolls back every write when the transaction throws", async () => {
      await e.put("boards", board("existing"))
      await expect(
        e.tx(["boards"], async (t) => {
          await t.put("boards", board("b1"))
          throw new Error("boom")
        }),
      ).rejects.toThrow("boom")
      expect(await e.get("boards", "b1")).toBeUndefined() // aborted write not persisted
      expect(await e.get("boards", "existing")).toBeDefined() // pre-existing untouched
    })


    it("reads back within the same transaction", async () => {
      await e.put("boards", board("b1", "seed"))
      const title = await e.tx(["boards"], async (t) => {
        const prev = await t.get<{ title: string }>("boards", "b1")
        await t.put("boards", board("b1", `${prev?.title ?? ""}-edited`))
        const now = await t.get<{ title: string }>("boards", "b1")
        return now?.title
      })
      expect(title).toBe("seed-edited")
    })
  })
}
