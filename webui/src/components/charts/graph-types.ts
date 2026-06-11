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
  layout?: "manual"                 // v0 only; "dagre"/"force" come later
}


export interface GraphNode {
  id: string
  x: number
  y: number
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
