import type {
  EdgeStyle as CanvasEdgeStyle,
  Style as CanvasStyle,
} from "@canvas-harness/core"
import { darkModeDisplayHex } from "@/features/board/lib/colors/dark-variants"
import type { Mode } from "./tokens"


/**
 * The three node-color fields canvas-harness reads when painting. They
 * are the ONLY fields we project in dark mode; geometry, stroke width,
 * opacity etc. pass through unchanged. Stored on `Node.data._storedColors`
 * so the source-of-truth survives a theme flip.
 */
export type StoredColors = {
  backgroundColor?: string
  strokeColor?: string
  textColor?: string
}


/**
 * Same as `StoredColors` but only the two fields that exist on an edge
 * (no `backgroundColor` — edges are stroke + label, no fill).
 */
export type StoredEdgeColors = {
  strokeColor?: string
  textColor?: string
}


/**
 * Project a single stored hex to the value the renderer should paint
 * in the given mode. Light mode is identity. Dark mode runs through
 * `darkModeDisplayHex` (Tailwind-anchored map + fallback HSL invert)
 * and falls back to the stored value if no projection is available
 * (e.g. `null`, transparent — `darkModeDisplayHex` returns the input).
 */
const projectColor = (
  stored: string | undefined,
  mode: Mode,
): string | undefined => {
  if (stored === undefined) return undefined
  if (mode === "light") return stored
  const adapted = darkModeDisplayHex(stored)
  return adapted ?? stored
}


/**
 * Project all node color fields. Returns `undefined` for any field
 * that was `undefined` in the input — preserving the lib's "fall back
 * to theme/default" contract for unset fields.
 */
export const adaptNodeColors = (
  stored: StoredColors,
  mode: Mode,
): StoredColors => ({
  backgroundColor: projectColor(stored.backgroundColor, mode),
  strokeColor: projectColor(stored.strokeColor, mode),
  textColor: projectColor(stored.textColor, mode),
})


/** Same as `adaptNodeColors` for edges (no `backgroundColor` field). */
export const adaptEdgeColors = (
  stored: StoredEdgeColors,
  mode: Mode,
): StoredEdgeColors => ({
  strokeColor: projectColor(stored.strokeColor, mode),
  textColor: projectColor(stored.textColor, mode),
})


/**
 * Pluck the color triplet out of a freshly-built canvas-harness Style —
 * used by the convert layer to capture the stored colors before any
 * dark-mode projection runs over the style.
 */
export const pickStoredColors = (style: CanvasStyle): StoredColors => ({
  backgroundColor: style.backgroundColor,
  strokeColor: style.strokeColor,
  textColor: style.textColor,
})


/** Edge variant of `pickStoredColors` — no `backgroundColor`. */
export const pickStoredEdgeColors = (style: CanvasEdgeStyle): StoredEdgeColors => ({
  strokeColor: style.strokeColor,
  textColor: style.textColor,
})


/**
 * Merge a `StoredColors` projection back onto a Style. Fields that
 * survived projection as `undefined` clear the field on the result so
 * the lib's fallback path (theme → default) takes over.
 *
 * `iconColor` mirrors `textColor` on purpose. canvas-harness's
 * `paintIconNode` substitutes every `currentColor` in the SVG markup
 * with `style.iconColor` before rasterizing — and the Tailwind
 * convention for icons (`<svg class="text-foreground">…</svg>`) is
 * that the icon's color follows the text/foreground color. By
 * mirroring textColor here we get the right behavior across every
 * call path (initial convert, theme flip, color picker, incoming
 * collab op) for free: anywhere this function runs, the icon glyph
 * tracks the same color the icon's "text" would. Harmless on
 * non-icon nodes — their paint functions ignore `iconColor`.
 */
export const applyColorsToStyle = (
  style: CanvasStyle,
  colors: StoredColors,
): CanvasStyle => ({
  ...style,
  backgroundColor: colors.backgroundColor,
  strokeColor: colors.strokeColor,
  textColor: colors.textColor,
  iconColor: colors.textColor,
})


/** Edge variant of `applyColorsToStyle`. */
export const applyColorsToEdgeStyle = (
  style: CanvasEdgeStyle,
  colors: StoredEdgeColors,
): CanvasEdgeStyle => ({
  ...style,
  strokeColor: colors.strokeColor,
  textColor: colors.textColor,
})
