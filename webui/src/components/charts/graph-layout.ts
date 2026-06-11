// Pure function: translate the agent-written `GraphProps` into the
// renderer-ready `LaidOutGraph`. Resolves color tokens, applies defaults,
// computes the viewBox from node extent when not provided, and joins edges
// to their endpoints by node id.
//
// Locked-down contract — test suite is the source of truth.

import { resolveColor } from "./color-token"
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


export class GraphLayoutError extends Error {}


export function layoutGraph(props: GraphProps): LaidOutGraph {
  const nodeIndex = indexNodes(props.nodes)
  const nodes = props.nodes.map(positionNode)
  const edges = props.edges
    .map((e) => positionEdge(e, nodeIndex))
    .filter((e): e is PositionedEdge => e != null)
  const viewBox = props.viewBox ?? autoViewBox(props.nodes)
  return { nodes, edges, viewBox }
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


function positionNode(n: GraphProps["nodes"][number]): PositionedNode {
  return {
    id: n.id,
    x: n.x,
    y: n.y,
    label: n.label ?? n.id,
    sublabel: n.sublabel ?? null,
    color: resolveColor(n.color ?? DEFAULT_NODE_FILL),
    border: resolveColor(n.border ?? DEFAULT_NODE_BORDER),
    textColor: resolveColor(n.textColor ?? DEFAULT_NODE_TEXT),
  }
}


function positionEdge(
  e: GraphProps["edges"][number],
  nodeIndex: Map<string, GraphProps["nodes"][number]>
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
  return {
    a: e.a,
    b: e.b,
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    label: e.label ?? null,
    color: resolveColor(e.color ?? DEFAULT_EDGE_COLOR),
  }
}


function autoViewBox(nodes: GraphProps["nodes"]): string {
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
