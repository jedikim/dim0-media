import type { Arrowhead, PathStyle } from "@canvas-harness/core"


export type ArrowheadOption = Arrowhead


/**
 * Display order for the arrowhead picker in the style panel. Mirrors
 * the order prod's `top-bar.tsx` uses for muscle-memory continuity.
 */
export const ARROWHEAD_OPTIONS: ReadonlyArray<ArrowheadOption> = [
  "none",
  "arrow",
  "arrow-filled",
  "barb",
]


/** Display order for the path-style picker (straight → bezier → polyline). */
export const PATH_STYLE_OPTIONS: ReadonlyArray<PathStyle> = [
  "straight",
  "bezier",
  "polyline",
]
