/**
 * Enable-sync orchestrator: promote a local-only board to synced (local → synced).
 *
 * The state machine, with deps injected so it unit-tests without IndexedDB or
 * the network. Order matters for both retry-safety AND the "edit during the sync
 * window" hazard:
 *   1. CAPTURE the board's content + the oplog seq it reflects (the base).
 *   2. ADOPT that base on the server (rebuilds the graph from it).
 *   3. FOLD the captured base into a local snapshot, truncating the oplog ONLY up
 *      to the captured seq. This is the crux: an edit made during steps 1–2 lands
 *      at a HIGHER seq and stays pending, so the v2 coordinator ships it to the
 *      server on connect — it is neither lost nor double-applied (the adopted
 *      base was folded away, not re-sent).
 *   4. MARK the board synced/v2 LAST, so a failure before this leaves it local and
 *      re-runnable (adopt is idempotent; a re-capture picks up any window edits).
 */
import type { Op } from "@canvas-harness/core"
import type { BoardContent } from "@/features/board/model"


export type EnableSyncResult =
  | { ok: true; boardId: string }
  | { ok: false; reason: "signed-out" }
  | { ok: false; reason: "limited" }
  | { ok: false; reason: "in-flight" }
  | { ok: false; reason: "error"; error: unknown }


/** Serialize board content into a batch of wire add-ops for the adopt endpoint. */
export const contentToAddOps = (content: BoardContent): Op[] => {
  const ops: Op[] = []
  for (const node of content.nodes) ops.push({ type: "node.add", node })
  for (const edge of content.edges) ops.push({ type: "edge.add", edge })
  return ops
}


export type EnableSyncDeps = {
  signedIn: boolean
  ownerId: string
  // Materialize the base to ship + the oplog seq it reflects (no truncation).
  capture: () => Promise<{ content: BoardContent; seq: number }>
  adopt: (ops: Op[]) => Promise<void>
  // Fold the captured base into a snapshot, truncating the oplog ONLY up to
  // `seq` so any edit made during the window stays pending for the sync client.
  foldBase: (content: BoardContent, seq: number) => Promise<void>
  markSynced: (ownerId: string) => Promise<void>
}


/** Run the promotion. Returns a discriminated result; never throws. */
export const enableSync = async (
  boardId: string,
  deps: EnableSyncDeps,
): Promise<EnableSyncResult> => {
  if (!deps.signedIn) return { ok: false, reason: "signed-out" }
  try {
    const { content, seq } = await deps.capture()
    await deps.adopt(contentToAddOps(content))
    await deps.foldBase(content, seq)
    await deps.markSynced(deps.ownerId)
    return { ok: true, boardId }
  } catch (error) {
    return { ok: false, reason: "error", error }
  }
}
