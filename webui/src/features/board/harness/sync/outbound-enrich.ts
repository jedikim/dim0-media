/**
 * Enrich outbound edge ops with `_midpoint` (the server's curve representation).
 *
 * The backend persists an edge's curve from a world-space `_midpoint`, not from
 * canvas-harness's native cubic `control` points (which it doesn't understand).
 * So before sending, we compute the on-curve midpoint from the control points
 * and attach it — otherwise a manually-dragged curve isn't persisted and reverts
 * to the default bezier on reload. Mirror of the legacy client's outbound
 * enrichment; inverse of `midpointToCubicControls`.
 *
 * Returns a CLONE with `_midpoint` attached (or the original batch untouched if
 * there's nothing to enrich) — the raw oplog keeps `control`, so a local reload
 * renders the curve natively.
 */
import type { CanvasStore, Edge, OpBatch, Vec2 } from "@canvas-harness/core"
import { endpointWorld } from "./inbound-normalize"


type EdgeEnd = Edge["source"] | Edge["target"]


/**
 * On-curve midpoint from symmetric cubic controls: with c1 = c2 = c the bezier
 * at t=0.5 passes through `(S + T + 6·c) / 8`. Null if geometry is incomplete.
 */
const midpointFromControl = (
  source: EdgeEnd | undefined,
  target: EdgeEnd | undefined,
  control: ReadonlyArray<Vec2> | undefined,
  store: CanvasStore,
): Vec2 | null => {
  if (!source || !target || !control || control.length === 0) return null
  const sourceWorld = endpointWorld(source, store)
  const targetWorld = endpointWorld(target, store)
  if (!sourceWorld || !targetWorld) return null
  const c = control[0]
  return {
    x: (sourceWorld.x + targetWorld.x + 6 * c.x) / 8,
    y: (sourceWorld.y + targetWorld.y + 6 * c.y) / 8,
  }
}


/** Attach `_midpoint` to outbound edge ops; returns a clone or the original. */
export const enrichEdgeMidpoints = (batch: OpBatch, store: CanvasStore): OpBatch => {
  let clone: OpBatch | null = null
  const ensureClone = (): OpBatch => (clone ??= structuredClone(batch))

  batch.ops.forEach((op, i) => {
    if (op.type === "edge.add") {
      const edge = op.edge as Edge & { control?: ReadonlyArray<Vec2> }
      const mid = midpointFromControl(edge.source, edge.target, edge.control, store)
      if (mid) {
        const target = (ensureClone().ops[i] as { edge: Edge & { _midpoint?: Vec2 } }).edge
        target._midpoint = mid
      }
    } else if (op.type === "edge.update") {
      const patch = op.patch as Partial<Edge> & { control?: ReadonlyArray<Vec2> }
      const existing = store.getEdge(op.id)
      const source = patch.source ?? existing?.source
      const targetEnd = patch.target ?? existing?.target
      const control = patch.control ?? (existing?.control as ReadonlyArray<Vec2> | undefined)
      const mid = midpointFromControl(source, targetEnd, control, store)
      if (mid) {
        const target = (ensureClone().ops[i] as { patch: Partial<Edge> & { _midpoint?: Vec2 } }).patch
        target._midpoint = mid
      }
    }
  })

  return clone ?? batch
}
