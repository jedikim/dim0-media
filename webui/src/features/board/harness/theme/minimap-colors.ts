import type { ThemeId } from "@/components/theme-constants"
import { getSwatch, type MinimapColors, type Mode } from "./tokens"
import { getSelectionColor } from "./selection-color"


/**
 * Read a CSS custom property from `:root`. Returns `undefined` when
 * SSR or the var isn't set so callers can fall back. Same helper
 * pattern as `theme/resolver.ts`.
 */
const readCssVar = (name: string): string | undefined => {
  if (typeof document === "undefined") return undefined
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || undefined
}


/**
 * Resolve all four Minimap colors for a Dim0 theme variant. Background
 * pulls from `--sidebar` so the minimap surface matches the app's
 * sidebar shell; the viewport box uses `--secondary-foreground` so it
 * reads as a foreground glyph against that sidebar surface. Falls
 * back to the swatch trio when CSS vars aren't readable (SSR / older
 * themes).
 */
export const getMinimapColors = (themeId: ThemeId, mode: Mode): MinimapColors => {
  const [bg, primary, accent] = getSwatch(themeId, mode)
  return {
    viewportColor: readCssVar("--secondary-foreground") ?? getSelectionColor(themeId, mode),
    backgroundColor: readCssVar("--sidebar") ?? bg,
    borderColor: accent,
    defaultNodeColor: primary,
  }
}
