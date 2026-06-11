// React component for the <graph> custom element. Pure SVG, hand-rolled.
//
// Thin layer: runs the pure layout function (graph-layout.ts), then maps
// the resulting positioned nodes/edges onto SVG primitives. All shape and
// color decisions live in the layout function or come from the agent;
// this file is just rendering.

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


export function GraphElement(props: GraphProps) {
  const graph = useMemo(() => layoutGraph(props), [props])
  const svgStyle: CSSProperties = {
    width: "100%",
    height: props.height ?? "auto",
    display: "block",
  }
  return (
    <svg viewBox={graph.viewBox} style={svgStyle} role="img">
      <g data-graph-layer="edges">
        {graph.edges.map((e) => (
          <EdgeLine key={`${e.a}-${e.b}`} edge={e} />
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


function EdgeLine({ edge }: { edge: PositionedEdge }) {
  return (
    <line
      data-graph-edge={`${edge.a}-${edge.b}`}
      x1={edge.x1}
      y1={edge.y1}
      x2={edge.x2}
      y2={edge.y2}
      stroke={edge.color}
      strokeWidth={EDGE_STROKE_WIDTH}
      strokeLinecap="round"
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
