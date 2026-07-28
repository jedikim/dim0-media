// The dangerous path: an edit made DURING first sync (local → synced).
//
// enable-sync captures a base, ships it to the server (adopt), then folds that
// base into a local snapshot. If an edit lands in the window between capture and
// fold, it must be (a) NOT in the adopted base, (b) preserved locally, and (c)
// left PENDING in the oplog so the v2 coordinator ships it to the server on
// connect. Losing it = permanent local/server divergence.
//
// These are integration tests: real BoardPersistence + a real canvas store + the
// real enableSync orchestrator. The window edit is injected from inside the fake
// `adopt` callback, which is exactly when the race occurs in production.

import { describe, expect, it } from "vitest"
import type { Op } from "@canvas-harness/core"
import { addNode, freshStore } from "@/test/canvas"
import { engineCases } from "@/test/engines"
import type { StorageEngine } from "@/features/board/persist/local/engine"
import type { OplogRecord } from "@/features/board/persist/local/idb"
import { BoardPersistence } from "@/features/board/persist/local/board-persistence"
import { enableSync } from "./enable-sync"


const MAX = Number.MAX_SAFE_INTEGER
const addIds = (ops: Op[]): string[] =>
  ops.filter((o) => o.type === "node.add").map((o) => (o as Extract<Op, { type: "node.add" }>).node.id)
const oplogOf = (engine: StorageEngine, boardId: string) =>
  engine.list<OplogRecord>("oplog", { range: { lower: [boardId, 0], upper: [boardId, MAX] } })


for (const { label, make } of engineCases) describe(`enable-sync window (${label})`, () => {
  it("preserves an edit made during the adopt window; keeps it pending, not in the base", async () => {
    const engine = await make()
    const p = new BoardPersistence("b", { engine })
    const store = freshStore("c")
    const detach = p.attach(store)

    // Base content the user promotes.
    addNode(store, "n1")
    addNode(store, "n2")
    await p.flush()

    let adoptedOps: Op[] = []
    const result = await enableSync("b", {
      signedIn: true,
      ownerId: "u1",
      capture: () => p.capture(),
      adopt: async (ops) => {
        adoptedOps = ops
        // WINDOW: a real edit lands mid-adopt (another tab / in-board promote).
        addNode(store, "n3-window")
        await p.flush()
      },
      foldBase: (content, seq) => p.foldBase(content, seq),
      markSynced: async () => {},
    })
    expect(result.ok).toBe(true)

    // (a) The server got ONLY the base — the window edit was not in the payload.
    expect(addIds(adoptedOps).sort()).toEqual(["n1", "n2"])
    expect(addIds(adoptedOps)).not.toContain("n3-window")

    // (b) The window edit survived locally: a fresh reload has all three nodes.
    const reloaded = await new BoardPersistence("b", { engine }).load()
    expect(reloaded.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2", "n3-window"])

    // (c) The base (n1,n2) was folded into the snapshot + truncated, but the
    //     window batch is still in the oplog as PENDING (no serverSeq) — so the
    //     coordinator ships exactly that one edit, and never re-sends the base.
    const oplog = await oplogOf(engine, "b")
    const pending = oplog.filter((r) => r.serverSeq === undefined)
    expect(pending).toHaveLength(1)
    const pendingAddIds = pending.flatMap((r) => addIds(r.batch.ops as Op[]))
    expect(pendingAddIds).toEqual(["n3-window"])

    detach()
  })

  it("no window edit: nothing is left pending after promotion", async () => {
    const engine = await make()
    const p = new BoardPersistence("b", { engine })
    const store = freshStore("c")
    p.attach(store)
    addNode(store, "n1")
    await p.flush()

    await enableSync("b", {
      signedIn: true,
      ownerId: "u1",
      capture: () => p.capture(),
      adopt: async () => {},
      foldBase: (content, seq) => p.foldBase(content, seq),
      markSynced: async () => {},
    })

    // Base folded into the snapshot, oplog fully truncated → nothing to re-send.
    expect(await oplogOf(engine, "b")).toHaveLength(0)
    const reloaded = await new BoardPersistence("b", { engine }).load()
    expect(reloaded.nodes.map((n) => n.id)).toEqual(["n1"])
  })

  it("REGRESSION GUARD: naive compact() would drop the window edit from the server", async () => {
    // Documents WHY foldBase exists. compact() re-materializes (folding the window
    // edit into the snapshot) and truncates the WHOLE oplog — so after adopt shipped
    // only the base, nothing is left pending and the server never learns of the
    // window edit: it lives locally forever but never syncs. foldBase avoids this.
    const engine = await make()
    const p = new BoardPersistence("b", { engine })
    const store = freshStore("c")
    p.attach(store)
    addNode(store, "n1")
    await p.flush()

    const { content } = await p.capture()
    // window edit
    addNode(store, "n2-window")
    await p.flush()
    // the naive path used before the fix:
    await p.compact()

    // Local has both...
    const reloaded = await new BoardPersistence("b", { engine }).load()
    expect(reloaded.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2-window"])
    // ...but NOTHING is pending, so the window edit would never reach the server
    // (adopt only shipped `content` = [n1]). This is the divergence foldBase prevents.
    expect(await oplogOf(engine, "b")).toHaveLength(0)
    expect(content.nodes.map((n) => n.id)).toEqual(["n1"]) // adopt payload lacked n2-window
  })
})
