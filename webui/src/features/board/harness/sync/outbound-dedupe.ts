/**
 * Collapse repeat update ops on the same target within a single batch.
 *
 * A compound edit (a `store.batch(...)`) can emit several `node.update` /
 * `edge.update` ops for the same id; a peer only needs the final value. Keep the
 * FIRST op's `prev` (the starting point, so conflict detection has a meaningful
 * anchor) and merge later patches over it (last value wins per field). Non-update
 * ops pass through in order. Returns the same batch when nothing collapses (no
 * allocation); clones the ops it keeps so the raw oplog batch is never mutated.
 *
 * Scope: this only helps MULTI-OP batches. A drag/resize emits one op per
 * pointer-tick as SEPARATE batches — collapsing those is cross-batch coalescing,
 * which is deferred (it complicates ack/cursor + reconnect-replay dedup).
 */
import type { Op, OpBatch } from "@canvas-harness/core"


const isUpdate = (op: Op): op is Extract<Op, { type: "node.update" | "edge.update" }> =>
  op.type === "node.update" || op.type === "edge.update"


/** Merge repeat same-target updates in a batch; returns a clone or the original. */
export const dedupeRepeatUpdates = (batch: OpBatch): OpBatch => {
  const out: Op[] = []
  const indexByKey = new Map<string, number>()
  let collapsed = false

  for (const op of batch.ops) {
    if (isUpdate(op)) {
      const key = `${op.type}:${op.id}`
      const at = indexByKey.get(key)
      if (at !== undefined) {
        // Same target seen earlier — merge this patch over the kept clone.
        const kept = out[at] as { patch: Record<string, unknown> }
        kept.patch = { ...kept.patch, ...(op.patch as Record<string, unknown>) }
        collapsed = true
        continue
      }
      indexByKey.set(key, out.length)
      out.push({ ...op, patch: { ...op.patch } } as Op) // clone: don't mutate the oplog op
    } else {
      out.push(op)
    }
  }

  return collapsed ? { ...batch, ops: out } : batch
}
