// React component for the <graph> custom element. Pure SVG, hand-rolled.
//
// Thin layer: runs the pure layout function (graph-layout.ts), then maps
// the resulting positioned nodes/edges onto SVG primitives. All shape,
// color, and position decisions live in the layout function or come from
// the agent; this file is just rendering.

import { useMemo } from "react"
import type { CSSProperties } from "react"

import { layoutGraph } from "./graph-layout"
import type {
  GraphProps,
  PositionedEdge,
  PositionedNode,
} from "./graph-types"


// Visual constants. Picked to match the reference Dijkstra HTML widget
// the agent originally produced — matches the "feel" so existing widgets
// don't have to be re-tuned when switching renderers.
const NODE_RADIUS = 23
const NODE_STROKE_WIDTH = 2
const NODE_LABEL_FONT_SIZE = 16
const NODE_LABEL_FONT_WEIGHT = 600
const NODE_LABEL_DY = 5                    // text baseline offset to vertically center inside circle
const SUBLABEL_FONT_SIZE = 11
const SUBLABEL_DY = NODE_RADIUS + 15       // distance below circle center
const EDGE_STROKE_WIDTH = 3
const EDGE_LABEL_FONT_SIZE = 11
const EDGE_LABEL_CHIP_WIDTH = 22
const EDGE_LABEL_CHIP_HEIGHT = 18
const EDGE_LABEL_CHIP_RADIUS = 7
// Arrowhead geometry (userSpaceOnUse, so size is independent of stroke).
const ARROW_SIZE = 10


export function GraphElement(props: GraphProps) {
  const graph = useMemo(() => layoutGraph(props), [props])
  const svgStyle: CSSProperties = {
    width: "100%",
    height: props.height ?? "auto",
    display: "block",
  }
  // One arrowhead marker per distinct edge color so each arrow matches its
  // line. Only needed for directed graphs.
  const arrowColors = useMemo(
    () =>
      graph.directed
        ? Array.from(new Set(graph.edges.map((e) => e.color)))
        : [],
    [graph.directed, graph.edges],
  )
  const markerIdFor = (color: string) =>
    `arrow-${arrowColors.indexOf(color)}`

  return (
    <svg viewBox={graph.viewBox} style={svgStyle} role="img">
      {arrowColors.length > 0 && (
        <defs>
          {arrowColors.map((color) => (
            <marker
              key={color}
              id={markerIdFor(color)}
              markerUnits="userSpaceOnUse"
              markerWidth={ARROW_SIZE}
              markerHeight={ARROW_SIZE}
              refX={ARROW_SIZE}
              refY={ARROW_SIZE / 2}
              orient="auto"
            >
              <path
                d={`M0,0 L${ARROW_SIZE},${ARROW_SIZE / 2} L0,${ARROW_SIZE} z`}
                fill={color}
              />
            </marker>
          ))}
        </defs>
      )}
      <g data-graph-layer="edges">
        {graph.edges.map((e) => (
          <EdgeLine
            key={`${e.a}-${e.b}`}
            edge={e}
            directed={graph.directed}
            markerId={graph.directed ? markerIdFor(e.color) : undefined}
          />
        ))}
      </g>
      <g data-graph-layer="edge-labels">
        {graph.edges
          .filter((e) => e.label != null)
          .map((e) => (
            <EdgeLabel key={`${e.a}-${e.b}-label`} edge={e} />
          ))}
      </g>
      <g data-graph-layer="nodes">
        {graph.nodes.map((n) => (
          <Node key={n.id} node={n} />
        ))}
      </g>
    </svg>
  )
}


/**
 * Pull both endpoints of an edge in toward the node centers so the line
 * (and any arrowhead) meets the circle boundary instead of the center.
 * Insetting both ends by the same amount leaves the midpoint — and thus
 * the edge-label chip — exactly where it was. The arrowhead end clears
 * the node radius; the marker's tip then lands on the boundary.
 */
function trimToBoundary(edge: PositionedEdge): {
  x1: number
  y1: number
  x2: number
  y2: number
} {
  const dx = edge.x2 - edge.x1
  const dy = edge.y2 - edge.y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  return {
    x1: edge.x1 + ux * NODE_RADIUS,
    y1: edge.y1 + uy * NODE_RADIUS,
    x2: edge.x2 - ux * NODE_RADIUS,
    y2: edge.y2 - uy * NODE_RADIUS,
  }
}


function EdgeLine({
  edge,
  directed,
  markerId,
}: {
  edge: PositionedEdge
  directed: boolean
  markerId?: string
}) {
  const seg = trimToBoundary(edge)
  return (
    <line
      data-graph-edge={`${edge.a}-${edge.b}`}
      x1={seg.x1}
      y1={seg.y1}
      x2={seg.x2}
      y2={seg.y2}
      stroke={edge.color}
      strokeWidth={EDGE_STROKE_WIDTH}
      strokeLinecap="round"
      markerEnd={directed && markerId ? `url(#${markerId})` : undefined}
    />
  )
}


function EdgeLabel({ edge }: { edge: PositionedEdge }) {
  const cx = (edge.x1 + edge.x2) / 2
  const cy = (edge.y1 + edge.y2) / 2
  return (
    <g data-graph-edge-label={`${edge.a}-${edge.b}`}>
      <rect
        x={cx - EDGE_LABEL_CHIP_WIDTH / 2}
        y={cy - EDGE_LABEL_CHIP_HEIGHT / 2}
        width={EDGE_LABEL_CHIP_WIDTH}
        height={EDGE_LABEL_CHIP_HEIGHT}
        rx={EDGE_LABEL_CHIP_RADIUS}
        fill="var(--card)"
        stroke="var(--border)"
      />
      <text
        x={cx}
        y={cy + 3}
        textAnchor="middle"
        fontSize={EDGE_LABEL_FONT_SIZE}
        fill="var(--muted-foreground)"
      >
        {edge.label}
      </text>
    </g>
  )
}


function Node({ node }: { node: PositionedNode }) {
  return (
    <g data-graph-node={node.id}>
      <circle
        cx={node.x}
        cy={node.y}
        r={NODE_RADIUS}
        fill={node.color}
        stroke={node.border}
        strokeWidth={NODE_STROKE_WIDTH}
      />
      <text
        x={node.x}
        y={node.y + NODE_LABEL_DY}
        textAnchor="middle"
        fontSize={NODE_LABEL_FONT_SIZE}
        fontWeight={NODE_LABEL_FONT_WEIGHT}
        fill={node.textColor}
      >
        {node.label}
      </text>
      {node.sublabel != null && (
        <text
          x={node.x}
          y={node.y + SUBLABEL_DY}
          textAnchor="middle"
          fontSize={SUBLABEL_FONT_SIZE}
          fill="var(--muted-foreground)"
        >
          {node.sublabel}
        </text>
      )}
    </g>
  )
}
