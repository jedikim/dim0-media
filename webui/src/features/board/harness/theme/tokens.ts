import type { CanvasBackground } from "@canvas-harness/core"
import type { ThemeResolver } from "@canvas-harness/react"
import { THEMES, type ThemeId } from "@/components/theme-constants"


export type Mode = "light" | "dark"


export type MinimapColors = {
  viewportColor: string
  backgroundColor: string
  borderColor: string
  defaultNodeColor: string
}


/**
 * The full set of canvas-harness chrome tokens for the board, derived
 * from a single Dim0 theme variant. Consumed by `useBoardTheme()` —
 * never construct directly inside a component.
 */
export type BoardThemeTokens = {
  resolver: ThemeResolver
  selectionColor: string
  minimap: MinimapColors
  background: CanvasBackground
}


type SwatchTriad = readonly [string, string, string]


/**
 * Return the [background, primary, accent] swatch trio for the given
 * theme variant. Falls back to the first registered theme when the id
 * is unknown so callers never see undefined.
 */
export const getSwatch = (themeId: ThemeId, mode: Mode): SwatchTriad => {
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]
  return mode === "dark" ? theme.swatchDark : theme.swatchLight
}
