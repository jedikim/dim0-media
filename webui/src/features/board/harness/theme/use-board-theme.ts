import { useEffect, useMemo, useState } from "react"
import { useTheme } from "@/components/theme-provider"
import { useBoardAppStore } from "../store/board-app-store"
import { getBackground } from "./background"
import { getMinimapColors } from "./minimap-colors"
import { makeBoardThemeResolver } from "./resolver"
import { getSelectionColor } from "./selection-color"
import { setBoardThemeMode } from "./theme-mode-ref"
import type { BoardThemeTokens } from "./tokens"


/**
 * Compose canvas-harness theming from the current Dim0 theme + per-board
 * localStorage overrides (background color + texture). Returns a
 * memoized `BoardThemeTokens` — feed straight to `<Canvas theme
 * selectionColor background />` and `<Minimap {...minimap}>`.
 *
 * Resolver identity is stable across renders of unchanged
 * (themeId, mode, boardBackground, boardBackgroundTexture); recreating
 * it would force `<Canvas>` to rebuild the renderer on every parent
 * re-render.
 */
export const useBoardTheme = (): BoardThemeTokens => {
  const { themeId, resolvedTheme } = useTheme()
  const boardBackground = useBoardAppStore((s) => s.boardBackground)
  const boardBackgroundTexture = useBoardAppStore((s) => s.boardBackgroundTexture)

  // The theme provider writes `data-theme`/`data-mode` in an effect that runs
  // AFTER this render, and a themeId-only change triggers no follow-up render
  // (unlike a mode change, which re-sets `resolvedTheme`). Since `getBackground`
  // reads live CSS vars (`--background`, `--muted-foreground`), the memo below
  // would otherwise capture the PREVIOUS theme's colors and never refresh —
  // leaving the canvas painted in the old theme. Recompute once the attributes
  // actually land on <html>.
  const [attrTick, setAttrTick] = useState(0)
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setAttrTick((t) => t + 1))
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme", "data-mode"] })
    return () => obs.disconnect()
  }, [])
  // Mirror the current mode onto the module-level ref so synchronous
  // convert calls (mindmap drain, agent apply, drop-files, hydrate) see
  // a consistent mode without prop-drilling. Set on every render —
  // cheap, and avoids a stale-singleton race when consumers run between
  // a theme flip and our useEffect.
  setBoardThemeMode(resolvedTheme)
  return useMemo<BoardThemeTokens>(
    () => ({
      resolver: makeBoardThemeResolver(themeId, resolvedTheme),
      selectionColor: getSelectionColor(themeId, resolvedTheme),
      minimap: getMinimapColors(themeId, resolvedTheme),
      background: getBackground({
        themeId,
        mode: resolvedTheme,
        boardBackground,
        boardBackgroundTexture,
      }),
    }),
    // attrTick isn't read in the body — it's a deliberate recompute trigger so
    // live CSS-var reads (background, pattern color) refresh once the just-applied
    // theme attributes land on <html>, not the prior theme's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeId, resolvedTheme, boardBackground, boardBackgroundTexture, attrTick],
  )
}
