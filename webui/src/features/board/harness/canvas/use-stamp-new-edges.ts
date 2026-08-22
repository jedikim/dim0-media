import { useEffect } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import {
  adaptEdgeColors,
  applyColorsToEdgeStyle,
  type StoredEdgeColors,
} from "../theme/color-adapter"
import { getBoardThemeMode } from "../theme/theme-mode-ref"
import {
  attachedNodeId,
  isImageReferenceTargetLocked,
  nextImageReferenceOrdinal,
  orderedImageReferences,
  readImageReferenceOrdinal,
} from "../image-reference-edges"


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
export const CANONICAL_EDGE_COLORS: StoredEdgeColors = {
  strokeColor: "#292524",
  textColor: "#000000",
}


/**
 * Resolve canonical stored colors for a fresh edge: prefer the user's
 * last picked colors (sticky style memory, light-space), fall back to
 * the canonical Dim0 defaults. Shared between the arrow-tool init
 * factory in `harness-canvas` and the paste rewrite below so both
 * agree on the source-of-truth.
 */
export const resolveStoredEdgeColors = (
  remembered: StoredEdgeColors | undefined,
): StoredEdgeColors => ({
  strokeColor: remembered?.strokeColor ?? CANONICAL_EDGE_COLORS.strokeColor,
  textColor: remembered?.textColor ?? CANONICAL_EDGE_COLORS.textColor,
})


/**
 * Rewrite pasted local `edge.add`s so they belong to the current
 * scope and paint in the current theme.
 *
 * Fresh arrow-drawn edges are stamped at creation time via
 * `arrowDefaults.{data,style}` in `harness-canvas` (canvas-harness
 * 0.1.24+), so they enter the store already initialized — the init
 * stamp doesn't need a follow-up `updateEdge` here. That removed
 * a redundant undo batch (Cmd+Z on a fresh edge used to take two
 * presses).
 *
 * Two stamps remain, both only relevant to **paste**:
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
 * theme (like the mindmap drain in `use-harness-apply-mindmap`, or
 * the arrow-tool factories in `harness-canvas`) or accept being
 * rewritten here (paying a second undo step).
 */
export const useStampNewEdges = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
  canEdit = true,
  local = false,
): void => {
  useEffect(() => {
    if (!boardId) return
    return store.subscribe("change", (batch) => {
      if (batch.origin !== "local") return
      for (const op of batch.ops) {
        if (op.type !== "edge.add") continue
        const data = (op.edge.data ?? {}) as Record<string, unknown>

        let referenceData: Record<string, unknown> | null = null
        const sourceNodeId = attachedNodeId(op.edge.source)
        const targetNodeId = attachedNodeId(op.edge.target)
        const sourceNode = sourceNodeId ? store.getNode(sourceNodeId) : null
        const targetNode = targetNodeId ? store.getNode(targetNodeId) : null
        const validReference = sourceNode !== null
          && sourceNode !== undefined
          && targetNode?.type === "image-generator"
          && (sourceNode.type === "image" || sourceNode.type === "image-generator")
        if (canEdit && !local && validReference && sourceNodeId && targetNodeId) {
          if (isImageReferenceTargetLocked(targetNodeId)) {
            store.removeEdge(op.edge.id)
            continue
          }
          const duplicate = orderedImageReferences(store, targetNodeId).some(
            (reference) => reference.edge.id !== op.edge.id
              && reference.sourceNodeId === sourceNodeId,
          )
          if (duplicate) {
            store.removeEdge(op.edge.id)
            continue
          }
          if (data.imageReference !== true || readImageReferenceOrdinal(data) === null) {
            referenceData = {
              imageReference: true,
              imageReferenceOrdinal: nextImageReferenceOrdinal(store, targetNodeId),
            }
          }
        } else if (data.imageReference === true && !validReference) {
          referenceData = {
            imageReference: null,
            imageReferenceOrdinal: null,
          }
        }

        const wantedParentId = rootId ?? undefined
        const scopeMismatched =
          data.graphUid !== boardId || data.parentId !== wantedParentId

        const existingStored = data._storedColors as StoredEdgeColors | undefined
        const currentStyle = op.edge.style ?? {}
        let displayColors: StoredEdgeColors | undefined
        let themeStale = false
        if (existingStored) {
          const mode = getBoardThemeMode()
          displayColors =
            mode === "dark" ? adaptEdgeColors(existingStored, "dark") : existingStored
          themeStale =
            currentStyle.strokeColor !== displayColors.strokeColor ||
            currentStyle.textColor !== displayColors.textColor
        }

        if (!scopeMismatched && !themeStale && !referenceData) continue

        const nextData: Record<string, unknown> = {
          ...data,
          graphUid: boardId,
          parentId: wantedParentId,
          ...referenceData,
        }
        const patch: Parameters<typeof store.updateEdge>[1] = { data: nextData }
        if (themeStale && displayColors) {
          patch.style = applyColorsToEdgeStyle(currentStyle, displayColors)
        }

        store.updateEdge(op.edge.id, patch)
      }
    })
  }, [store, boardId, rootId, canEdit, local])
}
