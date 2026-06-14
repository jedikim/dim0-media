import { type CSSProperties, useEffect, useMemo, useState } from "react"

import "./auth-graph-texture.css"


type NodeKind = "note" | "idea" | "chip" | "dot"

type Point = { x: number; y: number }


const COLORS = [
  "var(--sidebar-icon-1)",
  "var(--sidebar-icon-2)",
  "var(--sidebar-icon-3)",
  "var(--sidebar-icon-4)",
]


type AmbientNode = {
  kind: NodeKind
  color: string
  label: string
  // Fractional position across the viewport (0..1). Positions hug the
  // edges and leave the centre clear for the auth card.
  fx: number
  fy: number
}


const NODES: AmbientNode[] = [
  { kind: "note", color: COLORS[0], label: "ideas", fx: 0.12, fy: 0.22 },
  { kind: "dot", color: COLORS[1], label: "", fx: 0.07, fy: 0.48 },
  { kind: "chip", color: COLORS[2], label: "#focus", fx: 0.19, fy: 0.72 },
  { kind: "note", color: COLORS[1], label: "to-do", fx: 0.15, fy: 0.88 },
  { kind: "idea", color: COLORS[0], label: "a spark", fx: 0.85, fy: 0.26 },
  { kind: "dot", color: COLORS[2], label: "", fx: 0.74, fy: 0.5 },
  { kind: "note", color: COLORS[3], label: "notes", fx: 0.9, fy: 0.64 },
  { kind: "chip", color: COLORS[1], label: "#flow", fx: 0.82, fy: 0.86 },
  { kind: "dot", color: COLORS[0], label: "", fx: 0.5, fy: 0.1 },
  { kind: "idea", color: COLORS[2], label: "connect", fx: 0.52, fy: 0.9 },
]


// Sparse links between nearby nodes, by index.
const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [4, 5],
  [5, 6],
  [6, 7],
]

const MOBILE_BREAKPOINT = 768


/**
 * Ambient decorative graph for the auth screens. Renders a sparse field
 * of drifting nodes + wobbly connectors over the dot grid. No state
 * coupling and no anchoring — pure texture. Hidden on narrow viewports
 * where the card dominates.
 */
export function AuthGraphTexture() {
  const [vp, setVp] = useState<{ w: number; h: number }>(() => ({
    w: typeof window === "undefined" ? 1280 : window.innerWidth,
    h: typeof window === "undefined" ? 800 : window.innerHeight,
  }))

  useEffect(() => {
    const measure = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])

  // Inset the field slightly from the viewport edges so nothing clips.
  const points = useMemo<(AmbientNode & Point)[]>(() => {
    const pad = 36
    const left = pad
    const right = vp.w - pad
    const top = pad
    const bottom = vp.h - pad
    return NODES.map((n) => ({
      ...n,
      x: left + n.fx * (right - left),
      y: top + n.fy * (bottom - top),
    }))
  }, [vp])

  if (vp.w < MOBILE_BREAKPOINT) return null

  return (
    <div className="auth-graph" aria-hidden="true">
      <svg width={vp.w} height={vp.h} style={{ position: "absolute", inset: 0 }}>
        {EDGES.map(([a, b], i) => {
          const p1 = points[a]
          const p2 = points[b]
          if (!p1 || !p2) return null
          return (
            <path
              key={`e-${i}`}
              d={wobblePath(p1, p2, (a + b) * 1.3)}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.26}
              strokeWidth={1}
              fill="none"
              strokeLinecap="round"
            />
          )
        })}
      </svg>

      {points.map((p, i) => (
        <AuthGraphNode
          key={`n-${i}`}
          kind={p.kind}
          color={p.color}
          label={p.label}
          x={p.x}
          y={p.y}
          floatSeed={i}
        />
      ))}
    </div>
  )
}


/** Quadratic path between two points with a perpendicular wobble, so
 *  connectors read as hand-drawn rather than ruler-straight. */
function wobblePath(p1: Point, p2: Point, phase: number): string {
  const mx = (p1.x + p2.x) / 2
  const my = (p1.y + p2.y) / 2
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const wobble = Math.sin(phase) * 12
  const cpx = mx + nx * wobble
  const cpy = my + ny * wobble
  return `M ${p1.x} ${p1.y} Q ${cpx} ${cpy} ${p2.x} ${p2.y}`
}


type AuthGraphNodeProps = {
  kind: NodeKind
  color: string
  label: string
  x: number
  y: number
  floatSeed: number
}


/** One decorative node. Archetypes mirror the landing-page graph; each
 *  drifts on its own slow, staggered loop. */
function AuthGraphNode({ kind, color, label, x, y, floatSeed }: AuthGraphNodeProps) {
  const floatStyle: CSSProperties = {
    left: x,
    top: y,
    animationDuration: `${6 + (floatSeed % 4)}s`,
    animationDelay: `${(floatSeed % 5) * -0.7}s`,
  }

  if (kind === "dot") {
    return (
      <div
        className="auth-graph-node auth-graph-float"
        style={{
          ...floatStyle,
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          opacity: 0.5,
        }}
      />
    )
  }

  if (kind === "chip") {
    return (
      <div
        className="auth-graph-node auth-graph-float"
        style={{
          ...floatStyle,
          padding: "4px 10px",
          borderRadius: 999,
          background: `color-mix(in oklab, ${color} 16%, var(--card))`,
          color,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          border: `1px solid color-mix(in oklab, ${color} 40%, var(--border))`,
          opacity: 0.7,
        }}
      >
        {label}
      </div>
    )
  }

  if (kind === "idea") {
    return (
      <div
        className="auth-graph-node auth-graph-float"
        style={{
          ...floatStyle,
          padding: "9px 15px",
          borderRadius: 999,
          background: "var(--card)",
          border: `1.5px dashed ${color}`,
          boxShadow: "var(--shadow-sm)",
          fontFamily: "var(--font-handwriting)",
          fontSize: 14,
          color,
          opacity: 0.82,
        }}
      >
        {label}
      </div>
    )
  }

  // note (sticky paper)
  return (
    <div
      className="auth-graph-node auth-graph-float"
      style={{
        ...floatStyle,
        minWidth: 70,
        borderRadius: 6,
        background: `color-mix(in oklab, ${color} 22%, var(--card))`,
        border: `1px solid color-mix(in oklab, ${color} 46%, transparent)`,
        boxShadow: "0 4px 10px -4px hsl(32 28% 30% / 0.18)",
        padding: "8px 10px",
        fontFamily: "var(--font-handwriting)",
        fontSize: 12,
        color,
        opacity: 0.75,
      }}
    >
      {label}
    </div>
  )
}
