import { useEffect } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import {
  adaptEdgeColors,
  applyColorsToEdgeStyle,
  type StoredEdgeColors,
} from "../theme/color-adapter"
import { getBoardThemeMode } from "../theme/theme-mode-ref"


/**
 * Dim0 LinkStyle canonical-light defaults — mirror
 * `backend/topix/datatypes/note/style.py:LinkStyle`. Used as the
 * `_storedColors` fallback when a freshly-drawn edge has no prior
 * stamp. We CAN'T read from `op.edge.style.*` because the arrow
 * tool's defaults in dark mode are already theme-adapted (display
 * values, not canonical), and stamping those as if they were
 * canonical poisons the cross-theme sync (a light-mode peer would
 * adapt them as identity and see the dark hex).
 */
const CANONICAL_EDGE_COLORS: StoredEdgeColors = {
  strokeColor: "#292524",
  textColor: "#000000",
}


/**
 * Stamp identity, scope, and current-theme display on every local
 * `edge.add`.
 *
 * Three independent stamps that can each fire on its own:
 *
 *   - **init stamp** (`version === undefined`): a freshly-drawn arrow
 *     from canvas-harness's `useArrowTool` arrives with no `data`.
 *     Set version/createdAt, capture `_storedColors` (from sticky style
 *     memory via `rememberedEdgeColors`, falling back to canonical
 *     defaults), and (in dark mode) project to dark-adapted display
 *     style. Without this, the edge has no source-of-truth for theme
 *     adaptation later, and would ignore the user's last-picked colors.
 *
 *   - **rescope stamp** (scope mismatch): a pasted edge carries
 *     `version` + `_storedColors` from the source but its
 *     `data.graphUid`/`parentId` point at the source scope. Without
 *     this, a cross-board paste lands the edge with the source's
 *     `parent_id` and the REST root filter excludes it on refresh —
 *     same disappearing-on-refresh class of bug as nodes
 *     (see `use-stamp-new-nodes`).
 *
 *   - **retheme stamp** (theme stale): a pasted edge's `style.*` is
 *     baked for whatever theme was active at copy-time. If the user
 *     toggled theme between copy and paste — even in the same scope —
 *     the rendered colors would mismatch the current mode until the
 *     next theme toggle re-projects them.
 *
 * Hydrated edges arrive with `origin === "remote"` and are filtered
 * out by the batch-origin check.
 *
 * Invariant for future contributors: any new emitter of a local
 * `edge.add` must either pre-stamp scope + project style for current
 * theme (like the mindmap drain in `use-harness-apply-mindmap`) or
 * accept being rewritten here.
 *
 * Mirrors prod's [line-placement.ts](dim0/.../line-placement.ts)
 * which sets `parentId: rootId` directly at construction time.
 */
export const useStampNewEdges = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
  rememberedEdgeColors: () => StoredEdgeColors | undefined,
): void => {
  useEffect(() => {
    if (!boardId) return
    return store.subscribe("change", (batch) => {
      if (batch.origin !== "local") return
      for (const op of batch.ops) {
        if (op.type !== "edge.add") continue
        const data = (op.edge.data ?? {}) as Record<string, unknown>

        const wantedParentId = rootId ?? undefined
        const needsInit = data.version === undefined
        const scopeMismatched =
          data.graphUid !== boardId || data.parentId !== wantedParentId

        // Resolve final stored colors. Priority:
        //   1. `_storedColors` already on the edge (e.g. a pasted edge
        //      carrying its source colors) — always wins.
        //   2. The last color the user picked, from sticky style memory
        //      (canonical/light-space) — so a freshly-drawn edge inherits
        //      it, matching how new nodes inherit via `applyStyleMemory`.
        //      The arrow tool can't carry `_storedColors` through
        //      `ArrowToolDefaults`, so memory is the trusted channel.
        //   3. Canonical light defaults.
        // NEVER read from `style.*` — arrow-tool dark defaults are display
        // values that masquerade as canonical (see CANONICAL_EDGE_COLORS).
        const existingStored = data._storedColors as StoredEdgeColors | undefined
        const remembered = rememberedEdgeColors()
        const storedColors: StoredEdgeColors = existingStored ?? {
          strokeColor: remembered?.strokeColor ?? CANONICAL_EDGE_COLORS.strokeColor,
          textColor: remembered?.textColor ?? CANONICAL_EDGE_COLORS.textColor,
        }

        const mode = getBoardThemeMode()
        const displayColors =
          mode === "dark" ? adaptEdgeColors(storedColors, "dark") : storedColors
        const currentStyle = op.edge.style ?? {}
        const themeStale =
          existingStored !== undefined &&
          (currentStyle.strokeColor !== displayColors.strokeColor ||
            currentStyle.textColor !== displayColors.textColor)

        if (!needsInit && !scopeMismatched && !themeStale) continue

        const nextData: Record<string, unknown> = {
          ...data,
          graphUid: boardId,
          parentId: wantedParentId,
        }
        const patch: Parameters<typeof store.updateEdge>[1] = { data: nextData }

        if (needsInit) {
          nextData.version = 1
          nextData.createdAt = new Date().toISOString()
          nextData._storedColors = storedColors
          patch.style = applyColorsToEdgeStyle(currentStyle, displayColors)
        } else if (themeStale) {
          patch.style = applyColorsToEdgeStyle(currentStyle, displayColors)
        }

        store.updateEdge(op.edge.id, patch)
      }
    })
  }, [store, boardId, rootId, rememberedEdgeColors])
}
