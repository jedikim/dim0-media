/**
 * Give every undo/redo (`origin: "history"`) batch a fresh, unique id.
 *
 * canvas-harness's `redo()` re-applies the ORIGINAL batch with its ORIGINAL id
 * (`undo()` mints a fresh one; redo does not). In a synced/persisted log a
 * reused id collides with batch-id dedup:
 *   - the local oplog's `seen` set skips it → redo is never persisted,
 *   - the relay treats it as an already-applied replay → redo is never
 *     broadcast or re-applied server-side.
 * Either way redo silently does nothing across a reload or to peers.
 *
 * Semantically each undo/redo IS a new forward op in the shared log (you can't
 * rewind a shared log — you append the inverse/redo), so it should carry a new
 * id. This rewrites the id at the source. It must run as the FIRST `change`
 * subscriber so persistence and sync observe the rewritten id — mount it before
 * the persistence/collab hooks. Safe: the emitted history batch is a throwaway
 * copy, not the object held in the undo/redo stacks.
 */
import { useEffect } from "react"
import { asBatchId } from "@canvas-harness/core"
import type { BatchId, CanvasStore, Unsubscribe } from "@canvas-harness/core"


/** Subscribe the history-id rewrite to a store; returns the unsubscribe. */
export const installHistoryBatchIds = (store: CanvasStore): Unsubscribe =>
  store.subscribe("change", (batch) => {
    if (batch.origin === "history") {
      ;(batch as { id: BatchId }).id = asBatchId(store.generateId())
    }
  })


/** Hook wrapper — mount early (before persistence/collab) so it subscribes first. */
export const useHistoryBatchIds = (store: CanvasStore): void => {
  useEffect(() => installHistoryBatchIds(store), [store])
}
