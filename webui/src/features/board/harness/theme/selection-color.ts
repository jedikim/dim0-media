import type { ThemeId } from "@/components/theme-constants"
import type { Mode } from "./tokens"


/**
 * Selection chrome color — drives `<Canvas selectionColor>` and is
 * paired with `<Minimap viewportColor>` so the viewport box matches.
 *
 * One bright accent across all themes for v1 (chosen to read on both
 * light and dark backgrounds, matching canvas-harness's playground
 * default). Per-theme overrides plug in via OVERRIDES — tune as the
 * themes mature.
 */


const DEFAULT_SELECTION_COLOR = "#8b5cf6"


const OVERRIDES: Partial<Record<ThemeId, { light?: string; dark?: string }>> = {}


/** Selection color for outline / resize handles / marquee / draft edges. */
export const getSelectionColor = (themeId: ThemeId, mode: Mode): string =>
  OVERRIDES[themeId]?.[mode] ?? DEFAULT_SELECTION_COLOR
