// Pure function: translate the agent-written `GraphProps` into the
// renderer-ready `LaidOutGraph`. Resolves color tokens, applies defaults,
// computes node positions (manual / force / tree), derives the viewBox from
// node extent when not provided, and joins edges to their endpoints by id.
//
// Layout is internal: the agent never computes coordinates beyond the
// optional manual case. Given the same props this returns the same result
// (the force/tree engines are deterministic), so the caller's useMemo holds.
//
// Locked-down contract — test suite is the source of truth.

import { defaultPaletteColor, resolveColor } from "./color-token"
import { forceLayout } from "./graph-layout-force"
import { treeLayout } from "./graph-layout-tree"
import type {
  GraphProps,
  LaidOutGraph,
  PositionedEdge,
  PositionedNode,
} from "./graph-types"


// Default token names used when the agent doesn't supply a color. Pulled
// from shadcn / index.css so they auto-adapt to light/dark mode.
const DEFAULT_NODE_FILL = "card"
const DEFAULT_NODE_BORDER = "border"
const DEFAULT_NODE_TEXT = "foreground"
const DEFAULT_EDGE_COLOR = "border"


// Padding (in viewBox units) added around node extent when auto-computing
// the viewBox. Matches the visual feel of hand-laid examples like Dijkstra.
const AUTO_VIEWBOX_PADDING = 30


// How much of the chart color is mixed into the card surface for an
// auto-colored node fill. Low enough that the label (foreground) stays
// readable in both light and dark mode; the full chart color goes on the
// border, which carries the visible hue.
const AUTO_FILL_MIX_PCT = 18


type Point = { x: number; y: number }
type LayoutMode = "manual" | "force" | "tree"


export class GraphLayoutError extends Error {}


export function layoutGraph(props: GraphProps): LaidOutGraph {
  const nodeIndex = indexNodes(props.nodes)
  const mode = resolveMode(props)
  const positions = computePositions(props, mode)
  // Auto-laid graphs (force/tree) get a per-node color ramp so they don't
  // render as a field of identical neutral circles. Manual layouts stay
  // neutral by default — algorithm visualizers rely on a calm resting
  // state they color themselves (e.g. highlighting the visited node).
  const autoColor = mode === "force" || mode === "tree"
  const nodes = props.nodes.map((n, i) =>
    positionNode(n, positions.get(n.id) ?? { x: 0, y: 0 }, i, autoColor),
  )
  const edges = props.edges
    .map((e) => positionEdge(e, nodeIndex, positions))
    .filter((e): e is PositionedEdge => e != null)
  const viewBox = props.viewBox ?? autoViewBox(nodes)
  return { nodes, edges, viewBox, directed: props.directed ?? false }
}


/**
 * Pick the layout mode: an explicit `layout` always wins; otherwise use
 * the agent's manual coordinates when every node has both x and y, and
 * fall back to force-directed when any are missing.
 */
function resolveMode(props: GraphProps): LayoutMode {
  if (props.layout) return props.layout
  return props.nodes.every((n) => n.x != null && n.y != null)
    ? "manual"
    : "force"
}


/** Resolve every node id to a coordinate according to the chosen layout. */
function computePositions(
  props: GraphProps,
  mode: LayoutMode,
): Map<string, Point> {
  const nodeIds = props.nodes.map((n) => n.id)
  switch (mode) {
    case "force":
      return forceLayout(nodeIds, props.edges)
    case "tree":
      return treeLayout(nodeIds, props.edges, props.root)
    case "manual":
    default:
      return new Map(
        props.nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
      )
  }
}


function indexNodes(
  nodes: GraphProps["nodes"]
): Map<string, GraphProps["nodes"][number]> {
  const map = new Map<string, GraphProps["nodes"][number]>()
  for (const n of nodes) {
    if (map.has(n.id)) {
      throw new GraphLayoutError(`duplicate node id: ${n.id}`)
    }
    map.set(n.id, n)
  }
  return map
}


function positionNode(
  n: GraphProps["nodes"][number],
  pos: Point,
  index: number,
  autoColor: boolean,
): PositionedNode {
  // A fully unstyled node under an auto layout gets the chart ramp: a soft
  // tinted fill plus a full-strength chart border. Any explicit color or
  // border opts the node out, so agent-decorated nodes are never overridden.
  const ramp = autoColor && n.color == null && n.border == null
  const token = `chart-${(index % 5) + 1}`
  return {
    id: n.id,
    x: pos.x,
    y: pos.y,
    label: n.label ?? n.id,
    sublabel: n.sublabel ?? null,
    color: ramp
      ? `color-mix(in oklch, var(--${token}) ${AUTO_FILL_MIX_PCT}%, var(--card))`
      : resolveColor(n.color ?? DEFAULT_NODE_FILL),
    border: ramp
      ? defaultPaletteColor(index)
      : resolveColor(n.border ?? DEFAULT_NODE_BORDER),
    textColor: resolveColor(n.textColor ?? DEFAULT_NODE_TEXT),
  }
}


function positionEdge(
  e: GraphProps["edges"][number],
  nodeIndex: Map<string, GraphProps["nodes"][number]>,
  positions: Map<string, Point>,
): PositionedEdge | null {
  const a = nodeIndex.get(e.a)
  const b = nodeIndex.get(e.b)
  if (!a || !b) {
    // Drop with a warning rather than crashing — algorithm widgets may
    // briefly emit edges referencing nodes mid-transition.
    console.warn(
      `widget-dsl/graph: edge "${e.a}-${e.b}" references unknown node, dropping`
    )
    return null
  }
  const pa = positions.get(e.a) ?? { x: 0, y: 0 }
  const pb = positions.get(e.b) ?? { x: 0, y: 0 }
  return {
    a: e.a,
    b: e.b,
    x1: pa.x,
    y1: pa.y,
    x2: pb.x,
    y2: pb.y,
    label: e.label ?? null,
    color: resolveColor(e.color ?? DEFAULT_EDGE_COLOR),
  }
}


function autoViewBox(nodes: PositionedNode[]): string {
  if (nodes.length === 0) return "0 0 100 100"
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x > maxX) maxX = n.x
    if (n.y > maxY) maxY = n.y
  }
  const pad = AUTO_VIEWBOX_PADDING
  const x = minX - pad
  const y = minY - pad
  const w = maxX - minX + pad * 2
  const h = maxY - minY + pad * 2
  return `${x} ${y} ${w} ${h}`
}
