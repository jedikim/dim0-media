import type { ThemeResolver } from "@canvas-harness/react"
import type { ThemeId } from "@/components/theme-constants"
import { getSwatch, type Mode } from "./tokens"


const readCssVar = (name: string): string | undefined => {
  if (typeof document === "undefined") return undefined
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || undefined
}


/**
 * Build a canvas-harness ThemeResolver for a Dim0 theme variant.
 *
 * Resolves the five fallback tokens canvas-harness asks for —
 * `strokeColor`, `backgroundColor`, `textColor`, `edge.strokeColor`,
 * `edge.label.background` — from the theme's swatch trio (bg, primary,
 * accent). Per-node `style.*` always wins; this only fills gaps for
 * nodes/edges without an explicit color set.
 *
 * Also exposes a few extra tokens (`card`, `card.border`,
 * `muted-foreground`) for custom-node canvas placeholders to read.
 * These come straight from the CSS vars so they track theme switches
 * without duplicating values here.
 */
export const makeBoardThemeResolver = (themeId: ThemeId, mode: Mode): ThemeResolver => {
  const [bg, primary, accent] = getSwatch(themeId, mode)
  const tokens: Record<string, string> = {
    strokeColor: primary,
    backgroundColor: accent,
    textColor: primary,
    "edge.strokeColor": primary,
    "edge.label.background": bg,
    card: readCssVar("--card") ?? bg,
    "card.border": readCssVar("--border") ?? primary,
    "muted-foreground": readCssVar("--muted-foreground") ?? primary,
  }
  return (token) => tokens[token]
}
