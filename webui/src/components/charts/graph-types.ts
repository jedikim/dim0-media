// Type contract for the <graph> custom element.
//
// `<graph>` is intentionally generic — it renders node-link diagrams from a
// flat list of positioned nodes and edges. Per-node and per-edge color /
// border / label come straight from the props (resolved through the shared
// token resolver). Algorithm-specific styling (settled / frontier / unseen
// in a Dijkstra widget, healthy / degraded in a topology view, etc.) is
// the agent's responsibility — typically computed in a tier-2 behavior
// that returns pre-decorated `nodes` and `edges` arrays.


// === INPUT — what the agent writes (or pre-decorates from a behavior) ===


export interface GraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  viewBox?: string                  // explicit viewBox; otherwise auto-computed
  height?: number | string          // CSS height; default "auto" for aspect-preserved
  // How node positions are determined:
  //   "manual" — use the x/y the agent supplied on each node (algorithm
  //              visualizers, grids — anything needing exact placement).
  //   "force"  — auto-arrange via a force-directed simulation (general
  //              networks, dependency graphs).
  //   "tree"   — auto-arrange as a top-down hierarchy (taxonomies, org
  //              charts, decision trees); edges read as parent → child.
  // Default: "manual" when every node has x/y, otherwise "force".
  layout?: "manual" | "force" | "tree"
  // Draw arrowheads on edges (a → b). Defaults to false (undirected lines).
  directed?: boolean
  // Tree layout only: id of the root node. When omitted, the root is
  // inferred as the node with no incoming edge.
  root?: string
}


export interface GraphNode {
  id: string
  // Position in viewBox units. Optional: required only for "manual"
  // layout; "force"/"tree" compute these. When some nodes have x/y and
  // others don't under manual layout, missing coords default to 0.
  x?: number
  y?: number
  label?: string                    // text inside the circle (defaults to id)
  sublabel?: string                 // small text below the circle (e.g. distance, count)
  color?: string                    // background fill — default token: `card`
  border?: string                   // stroke — default token: `border`
  textColor?: string                // text color — default token: `foreground`
}


export interface GraphEdge {
  a: string                         // node id
  b: string                         // node id
  label?: string                    // text on the edge (weight, capacity, name)
  color?: string                    // stroke — default token: `border`
}


// === INTERMEDIATE — what the renderer consumes (post-layout) ===
// Colors are already resolved to CSS (`var(--X)` or pass-through).


export interface LaidOutGraph {
  nodes: PositionedNode[]
  edges: PositionedEdge[]
  viewBox: string
  directed: boolean                 // render arrowheads (a → b) when true
}


export interface PositionedNode {
  id: string
  x: number
  y: number
  label: string
  sublabel: string | null
  color: string                     // resolved CSS
  border: string                    // resolved CSS
  textColor: string                 // resolved CSS
}


export interface PositionedEdge {
  a: string
  b: string
  x1: number
  y1: number
  x2: number
  y2: number
  label: string | null
  color: string                     // resolved CSS
}
