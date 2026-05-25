import type { PathStyle } from "@canvas-harness/core"
import type { ArrowheadOption } from "./edge-glyph-options"


/**
 * Glyph for an arrowhead style — drawn as a short stroke with the
 * head primitive attached at the right end. Used both inside the
 * ToggleGroupItem and as the row indicator in the rail panel. `flip`
 * mirrors horizontally for the source-side arrowhead.
 */
export function ArrowheadGlyph({
  kind,
  flip = false,
}: {
  kind: ArrowheadOption
  flip?: boolean
}) {
  return (
    <svg
      width="28"
      height="14"
      viewBox="0 0 28 14"
      className="text-foreground/80"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <line
        x1="2"
        y1="7"
        x2="22"
        y2="7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {kind === "arrow" && (
        <path
          d="M16 3 L22 7 L16 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {kind === "arrow-filled" && (
        <path d="M16 3 L22 7 L16 11 Z" fill="currentColor" stroke="none" />
      )}
      {kind === "barb" && (
        <>
          <path
            d="M16 3 L22 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M16 11 L22 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  )
}


/**
 * Glyph for an edge `pathStyle`. Renders a short curve / line /
 * polyline so the user can recognize the path shape in a toggle.
 */
export function PathStyleGlyph({ kind }: { kind: PathStyle }) {
  return (
    <svg width="28" height="14" viewBox="0 0 28 14" className="text-foreground/80">
      {kind === "straight" && (
        <line
          x1="2"
          y1="7"
          x2="26"
          y2="7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
      {kind === "bezier" && (
        <path
          d="M2 11 C 8 1, 20 13, 26 3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
      {kind === "polyline" && (
        <polyline
          points="2,11 10,11 18,3 26,3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}


