import { type CSSProperties, useEffect, useMemo, useState } from "react"
import { useEdges, useNodes } from "@canvas-harness/react"

import { useBoardAppStore } from "../store/board-app-store"
import "./empty-board-coachmarks.css"


type AnchorKey = "title" | "toolbar" | "share" | "ai-island"

type NodeKind = "note" | "idea" | "chip" | "dot"

type Point = { x: number; y: number }


/** The four chrome targets a callout can point at, keyed by their
 *  `data-coachmark` attribute. */
const ANCHOR_KEYS: AnchorKey[] = ["title", "toolbar", "share", "ai-island"]

const SIDEBAR_COLORS = [
  "var(--sidebar-icon-1)",
  "var(--sidebar-icon-2)",
  "var(--sidebar-icon-3)",
  "var(--sidebar-icon-4)",
]


type Callout = {
  anchor: AnchorKey
  label: string
  color: string
  // Which side of the anchor the bubble floats on, so the connector
  // curves away from the chrome instead of across it.
  side: "below" | "above"
  // Bubble offset from the anchor's connect edge, in px.
  dx: number
  dy: number
}


const CALLOUTS: Callout[] = [
  { anchor: "title", label: "name your\ncanvas", color: SIDEBAR_COLORS[1], side: "below", dx: 18, dy: 70 },
  { anchor: "toolbar", label: "tools to\nbuild", color: SIDEBAR_COLORS[0], side: "below", dx: 6, dy: 84 },
  { anchor: "share", label: "share &\ninvite", color: SIDEBAR_COLORS[2], side: "below", dx: -14, dy: 70 },
  { anchor: "ai-island", label: "or ask the\nAI agent", color: SIDEBAR_COLORS[3], side: "above", dx: 0, dy: -96 },
]


type Ambient = {
  kind: NodeKind
  color: string
  label: string
  // Fractional position inside the safe canvas region (0..1).
  fx: number
  fy: number
}


const AMBIENT: Ambient[] = [
  { kind: "note", color: SIDEBAR_COLORS[0], label: "ideas", fx: 0.15, fy: 0.34 },
  { kind: "chip", color: SIDEBAR_COLORS[2], label: "#topic", fx: 0.28, fy: 0.66 },
  { kind: "dot", color: SIDEBAR_COLORS[1], label: "", fx: 0.21, fy: 0.5 },
  { kind: "idea", color: SIDEBAR_COLORS[0], label: "a hunch", fx: 0.8, fy: 0.36 },
  { kind: "note", color: SIDEBAR_COLORS[3], label: "notes", fx: 0.86, fy: 0.62 },
  { kind: "dot", color: SIDEBAR_COLORS[2], label: "", fx: 0.72, fy: 0.52 },
  { kind: "chip", color: SIDEBAR_COLORS[1], label: "#link", fx: 0.52, fy: 0.82 },
  { kind: "note", color: SIDEBAR_COLORS[1], label: "to-do", fx: 0.62, fy: 0.2 },
  { kind: "dot", color: SIDEBAR_COLORS[0], label: "", fx: 0.4, fy: 0.18 },
]


// Sparse links between ambient nodes, by index — just enough to read as
// a graph rather than scattered confetti.
const AMBIENT_EDGES: [number, number][] = [
  [0, 2],
  [2, 1],
  [3, 5],
  [5, 4],
  [8, 0],
  [7, 6],
]

const MOBILE_BREAKPOINT = 768


/**
 * Decorative onboarding overlay for an empty board. Renders the dim0
 * landing-page graph aesthetic (sticky notes, dashed idea bubbles, mono
 * chips, dots) with a gentle drift, plus four labelled callouts whose
 * connectors point at the real board chrome (title, toolbar, share, AI
 * island). Mounts only while the canvas is empty and editable; the first
 * node or edge created unmounts it.
 */
export function EmptyBoardCoachmarks({ ready }: { ready: boolean }) {
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const presentationMode = useBoardAppStore((s) => s.presentationMode)
  const nodes = useNodes()
  const edges = useEdges()
  const isEmpty = nodes.length === 0 && edges.length === 0
  const show = ready && canEdit && !presentationMode && isEmpty

  const [vp, setVp] = useState<{ w: number; h: number }>(() => ({
    w: typeof window === "undefined" ? 1280 : window.innerWidth,
    h: typeof window === "undefined" ? 800 : window.innerHeight,
  }))
  const [anchors, setAnchors] = useState<Partial<Record<AnchorKey, DOMRect>>>({})

  // Measure the viewport + chrome anchors. Chrome can mount a frame
  // after us, so we re-measure on a couple of animation frames as well
  // as on resize.
  useEffect(() => {
    if (!show) return
    const measure = () => {
      setVp({ w: window.innerWidth, h: window.innerHeight })
      const next: Partial<Record<AnchorKey, DOMRect>> = {}
      for (const key of ANCHOR_KEYS) {
        const el = document.querySelector(`[data-coachmark="${key}"]`)
        if (el) next[key] = el.getBoundingClientRect()
      }
      setAnchors(next)
    }
    measure()
    const r1 = requestAnimationFrame(measure)
    const r2 = requestAnimationFrame(() => requestAnimationFrame(measure))
    window.addEventListener("resize", measure)
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
      window.removeEventListener("resize", measure)
    }
  }, [show])

  // Safe region for ambient nodes: inset from edges, clear of the top
  // chrome row and the bottom AI island.
  const region = useMemo(() => {
    const left = 28
    const right = vp.w - 28
    const top = 84
    const bottom = vp.h - 128
    return { left, right, top, bottom }
  }, [vp])

  const ambientPoints = useMemo(
    () =>
      AMBIENT.map((a) => ({
        ...a,
        x: region.left + a.fx * (region.right - region.left),
        y: region.top + a.fy * (region.bottom - region.top),
      })),
    [region],
  )

  if (!show) return null
  if (vp.w < MOBILE_BREAKPOINT) return null

  const connectors = CALLOUTS.map((c) => {
    const rect = anchors[c.anchor]
    if (!rect) return null
    const cx = rect.left + rect.width / 2
    const connect: Point =
      c.side === "below"
        ? { x: cx, y: rect.bottom + 4 }
        : { x: cx, y: rect.top - 4 }
    const bubble: Point =
      c.side === "below"
        ? { x: cx + c.dx, y: rect.bottom + c.dy }
        : { x: cx + c.dx, y: rect.top + c.dy }
    return { callout: c, connect, bubble }
  }).filter((v): v is { callout: Callout; connect: Point; bubble: Point } => v !== null)

  return (
    <div className="coachmark-layer" aria-hidden="true">
      <svg
        width={vp.w}
        height={vp.h}
        style={{ position: "absolute", inset: 0 }}
      >
        {AMBIENT_EDGES.map(([a, b], i) => {
          const p1 = ambientPoints[a]
          const p2 = ambientPoints[b]
          if (!p1 || !p2) return null
          return (
            <path
              key={`ae-${i}`}
              d={wobblePath(p1, p2, (a + b) * 1.3)}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.28}
              strokeWidth={1}
              fill="none"
              strokeLinecap="round"
            />
          )
        })}

        {connectors.map(({ callout, connect, bubble }) => (
          <Connector key={`cn-${callout.anchor}`} from={bubble} to={connect} color={callout.color} />
        ))}
      </svg>

      {ambientPoints.map((p, i) => (
        <CoachmarkNode
          key={`an-${i}`}
          kind={p.kind}
          color={p.color}
          label={p.label}
          x={p.x}
          y={p.y}
          floatSeed={i}
        />
      ))}

      {connectors.map(({ callout, bubble }, i) => (
        <CoachmarkNode
          key={`cl-${callout.anchor}`}
          kind="idea"
          color={callout.color}
          label={callout.label}
          x={bubble.x}
          y={bubble.y}
          floatSeed={i + 0.5}
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


/** A curved connector from a callout bubble to a chrome anchor, capped
 *  with a small arrowhead at the anchor end. */
function Connector({ from, to, color }: { from: Point; to: Point; color: string }) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const size = 7
  // Two barbs rotated ~30° off the incoming direction.
  const left = {
    x: to.x - ux * size - uy * size * 0.6,
    y: to.y - uy * size + ux * size * 0.6,
  }
  const right = {
    x: to.x - ux * size + uy * size * 0.6,
    y: to.y - uy * size - ux * size * 0.6,
  }
  return (
    <g>
      <path
        d={wobblePath(from, to, (from.x + to.y) * 0.01)}
        stroke={color}
        strokeOpacity={0.5}
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={`M ${left.x} ${left.y} L ${to.x} ${to.y} L ${right.x} ${right.y}`}
        stroke={color}
        strokeOpacity={0.6}
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}


type CoachmarkNodeProps = {
  kind: NodeKind
  color: string
  label: string
  x: number
  y: number
  floatSeed: number
}


/** One decorative node. Visual archetypes mirror the landing-page graph;
 *  each drifts on its own slow, staggered loop. */
function CoachmarkNode({ kind, color, label, x, y, floatSeed }: CoachmarkNodeProps) {
  const floatStyle: CSSProperties = {
    left: x,
    top: y,
    animationDuration: `${5 + (floatSeed % 4)}s`,
    animationDelay: `${(floatSeed % 5) * -0.7}s`,
  }

  if (kind === "dot") {
    return (
      <div
        className="coachmark-node coachmark-float"
        style={{
          ...floatStyle,
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          opacity: 0.62,
        }}
      />
    )
  }

  if (kind === "chip") {
    return (
      <div
        className="coachmark-node coachmark-float"
        style={{
          ...floatStyle,
          padding: "4px 10px",
          borderRadius: 999,
          background: `color-mix(in oklab, ${color} 18%, var(--card))`,
          color,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          border: `1px solid color-mix(in oklab, ${color} 44%, var(--border))`,
          opacity: 0.8,
        }}
      >
        {label}
      </div>
    )
  }

  if (kind === "idea") {
    return (
      <div
        className="coachmark-node coachmark-float"
        style={{
          ...floatStyle,
          padding: "9px 15px",
          borderRadius: 999,
          background: "var(--card)",
          border: `1.5px dashed ${color}`,
          boxShadow: "var(--shadow-sm)",
          fontFamily: "var(--font-handwriting)",
          fontSize: 14,
          lineHeight: 1.15,
          textAlign: "center",
          whiteSpace: "pre-line",
          color,
          opacity: 0.92,
        }}
      >
        {label}
      </div>
    )
  }

  // note (sticky paper)
  return (
    <div
      className="coachmark-node coachmark-float"
      style={{
        ...floatStyle,
        minWidth: 78,
        borderRadius: 6,
        background: `color-mix(in oklab, ${color} 24%, var(--card))`,
        border: `1px solid color-mix(in oklab, ${color} 50%, transparent)`,
        boxShadow: "0 4px 10px -4px hsl(32 28% 30% / 0.18)",
        padding: "8px 10px",
        fontFamily: "var(--font-handwriting)",
        fontSize: 12,
        lineHeight: 1.25,
        whiteSpace: "pre-line",
        color,
        opacity: 0.85,
      }}
    >
      {label}
    </div>
  )
}
