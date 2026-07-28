/**
 * Normalize a relay batch for local application (theme + geometry).
 *
 * The relay ships canonical, theme-independent data: node/edge colors live in
 * `data._storedColors`, and an edge's curve is a world-space `_midpoint`. Before
 * a batch is applied to the local store it must be re-projected for the local
 * theme and have its cubic controls recovered — otherwise a dark-mode peer's
 * colors land wrong and edges crash the renderer. Custom node types also get
 * `autoFit` forced off (they preview content).
 *
 * The pure logic (`color-adapter`, `midpointToCubicControls`, `normalize-autofit`)
 * is shared with the legacy client; this is the batch-walk for the new
 * coordinator. Mutates the batch in place — it's freshly decoded and owned here.
 */
import { asNodeId, midpointToCubicControls } from "@canvas-harness/core"
import type { CanvasStore, Edge, Node, Op, OpBatch, Vec2 } from "@canvas-harness/core"
import {
  adaptEdgeColors,
  adaptNodeColors,
  applyColorsToEdgeStyle,
  applyColorsToStyle,
  type StoredColors,
  type StoredEdgeColors,
} from "../theme/color-adapter"
import { getBoardThemeMode } from "../theme/theme-mode-ref"
import { normalizeBatchAutoFit } from "../canvas/normalize-autofit"


type ThemeMode = "light" | "dark"


/** Re-project a node's stored colors into the local theme's display style. */
const rewriteNodeStyle = (target: Partial<Node>, mode: ThemeMode): void => {
  const stored = (target.data as { _storedColors?: StoredColors } | undefined)?._storedColors
  if (!stored) return
  target.style = applyColorsToStyle(target.style ?? {}, adaptNodeColors(stored, mode))
}


/** Re-project an edge's stored colors into the local theme's display style. */
const rewriteEdgeStyle = (target: Partial<Edge>, mode: ThemeMode): void => {
  const stored = (target.data as { _storedColors?: StoredEdgeColors } | undefined)?._storedColors
  if (!stored) return
  target.style = applyColorsToEdgeStyle(target.style ?? {}, adaptEdgeColors(stored, mode))
}


/** Re-theme whichever payload an op carries (node/edge, add/update). */
const rewriteOpColors = (op: Op, mode: ThemeMode): void => {
  if (op.type === "node.add") rewriteNodeStyle(op.node, mode)
  else if (op.type === "node.update") rewriteNodeStyle(op.patch as Partial<Node>, mode)
  else if (op.type === "edge.add") rewriteEdgeStyle(op.edge, mode)
  else if (op.type === "edge.update") rewriteEdgeStyle(op.patch as Partial<Edge>, mode)
}


/** World coords of an edge end (attached → node + offset; free → its point). */
export const endpointWorld = (end: Edge["source"] | Edge["target"], store: CanvasStore): Vec2 | null => {
  if ("nodeId" in end) {
    const node = store.getNode(end.nodeId)
    if (!node) return null
    return { x: node.x + end.localOffset.x, y: node.y + end.localOffset.y }
  }
  return end.worldPoint
}


/** Default a missing `localOffset` on an attached end so projection can't crash. */
const patchEdgeEnd = (end: unknown, store: CanvasStore): void => {
  if (!end || typeof end !== "object") return
  const e = end as { nodeId?: string; localOffset?: { x: number; y: number } }
  if (!e.nodeId) return
  if (e.localOffset && typeof e.localOffset.x === "number") return
  const node = store.getNode(asNodeId(e.nodeId))
  e.localOffset = node ? { x: node.w / 2, y: node.h / 2 } : { x: 0, y: 0 }
}


/** Recover cubic controls from a `_midpoint` using local endpoint positions. */
const controlsFromMidpoint = (
  source: Edge["source"] | Edge["target"] | undefined,
  target: Edge["source"] | Edge["target"] | undefined,
  midpoint: Vec2,
  store: CanvasStore,
): [Vec2, Vec2] | null => {
  if (!source || !target) return null
  const sourceWorld = endpointWorld(source, store)
  const targetWorld = endpointWorld(target, store)
  if (!sourceWorld || !targetWorld) return null
  const { c1, c2 } = midpointToCubicControls(sourceWorld, midpoint, targetWorld)
  return [c1, c2]
}


/** Patch dangling endpoints, default the path style, and expand `_midpoint`. */
const patchEdgeGeometry = (batch: OpBatch, store: CanvasStore): void => {
  for (const op of batch.ops) {
    if (op.type === "edge.add") {
      const edge = op.edge as Edge & { _midpoint?: Vec2 }
      patchEdgeEnd(edge.source, store)
      patchEdgeEnd(edge.target, store)
      if (!edge.pathStyle) edge.pathStyle = "bezier"
      if (edge._midpoint && !edge.control) {
        const controls = controlsFromMidpoint(edge.source, edge.target, edge._midpoint, store)
        if (controls) edge.control = controls
      }
      delete edge._midpoint
    } else if (op.type === "edge.update") {
      const patch = op.patch as Partial<Edge> & { _midpoint?: Vec2 }
      if (patch.source) patchEdgeEnd(patch.source, store)
      if (patch.target) patchEdgeEnd(patch.target, store)
      if (patch._midpoint && !patch.control) {
        const existing = store.getEdge(op.id)
        const controls = controlsFromMidpoint(
          patch.source ?? existing?.source,
          patch.target ?? existing?.target,
          patch._midpoint,
          store,
        )
        if (controls) patch.control = controls
      }
      delete patch._midpoint
    }
  }
}


/**
 * Normalize a relay batch in place for local application: re-theme colors,
 * disable autoFit on custom types, and recover edge geometry.
 */
export const normalizeInboundBatch = (batch: OpBatch, store: CanvasStore): void => {
  const mode = getBoardThemeMode()
  for (const op of batch.ops) rewriteOpColors(op, mode)
  normalizeBatchAutoFit(batch, store)
  patchEdgeGeometry(batch, store)
}
