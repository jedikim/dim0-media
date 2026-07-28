import { asBatchId } from "@canvas-harness/core"
import type { CanvasStore, Op, OpBatch } from "@canvas-harness/core"


/**
 * Build a committed op-batch envelope for `store` — a fresh batch id, the
 * store's client id, and a timestamp — around the given origin + ops.
 *
 * The single source of the envelope shape shared by every `applyBatch` /
 * `persistence.record` call site, so the id/clientId/ts plumbing lives in one
 * place instead of being hand-rolled (and drifting) at each one.
 */
export const makeBatch = (store: CanvasStore, origin: OpBatch["origin"], ops: Op[]): OpBatch => ({
  id: asBatchId(store.generateId()),
  clientId: store.clientId,
  ts: Date.now(),
  origin,
  ops,
})
