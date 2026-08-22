import { useEffect } from "react"
import type { CanvasStore, Edge, NodeId } from "@canvas-harness/core"
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

    const originalAddEdge = store.addEdge
    const originalUpdateEdge = store.updateEdge
    const originalRemoveEdge = store.removeEdge

    const validReferenceEndpoints = (
      edge: Pick<Edge, "id" | "source" | "target">,
    ): { sourceNodeId: NodeId; targetNodeId: NodeId } | null => {
      const sourceNodeId = attachedNodeId(edge.source)
      const targetNodeId = attachedNodeId(edge.target)
      if (!sourceNodeId || !targetNodeId) return null
      const sourceNode = store.getNode(sourceNodeId)
      const targetNode = store.getNode(targetNodeId)
      if (
        targetNode?.type !== "image-generator"
        || (sourceNode?.type !== "image" && sourceNode?.type !== "image-generator")
      ) return null
      return { sourceNodeId, targetNodeId }
    }

    const duplicatesReference = (edge: Pick<Edge, "id" | "source" | "target">): boolean => {
      const endpoints = validReferenceEndpoints(edge)
      if (!endpoints) return false
      return orderedImageReferences(store, endpoints.targetNodeId).some(
        (reference) => reference.edge.id !== edge.id
          && reference.sourceNodeId === endpoints.sourceNodeId,
      )
    }

    const guardedAddEdge: CanvasStore["addEdge"] = (edge) => {
      const endpoints = validReferenceEndpoints(edge)
      if (
        canEdit
        && !local
        && endpoints
        && (isImageReferenceTargetLocked(endpoints.targetNodeId) || duplicatesReference(edge))
      ) return edge.id
      return originalAddEdge(edge)
    }
    const guardedUpdateEdge: CanvasStore["updateEdge"] = (edgeId, patch) => {
      const current = store.getEdge(edgeId)
      if (canEdit && !local && current) {
        const oldTargetNodeId = attachedNodeId(current.target)
        const oldData = (current.data ?? {}) as Record<string, unknown>
        const next = { ...current, ...patch } as Edge
        const nextEndpoints = validReferenceEndpoints(next)
        if (
          (oldData.imageReference === true
            && oldTargetNodeId
            && isImageReferenceTargetLocked(oldTargetNodeId))
          || (nextEndpoints && isImageReferenceTargetLocked(nextEndpoints.targetNodeId))
          || duplicatesReference(next)
        ) return
      }
      originalUpdateEdge(edgeId, patch)
    }
    const guardedRemoveEdge: CanvasStore["removeEdge"] = (edgeId) => {
      const current = store.getEdge(edgeId)
      const targetNodeId = current ? attachedNodeId(current.target) : null
      const data = (current?.data ?? {}) as Record<string, unknown>
      if (
        canEdit
        && !local
        && data.imageReference === true
        && targetNodeId
        && isImageReferenceTargetLocked(targetNodeId)
      ) return
      originalRemoveEdge(edgeId)
    }

    store.addEdge = guardedAddEdge
    store.updateEdge = guardedUpdateEdge
    store.removeEdge = guardedRemoveEdge

    const unsubscribe = store.subscribe("change", (batch) => {
      if (batch.origin !== "local") return
      for (const op of batch.ops) {
        if (op.type !== "edge.add" && op.type !== "edge.update" && op.type !== "edge.remove") {
          continue
        }
        const edgeId = op.type === "edge.update" ? op.id : op.edge.id

        const currentEdge = op.type === "edge.remove" ? null : store.getEdge(edgeId)
        const oldEdge = op.type === "edge.add"
          ? null
          : op.type === "edge.remove"
          ? op.edge
          : currentEdge
            ? { ...currentEdge, ...op.prev } as Edge
            : null
        const nextEdge = currentEdge
        const oldTargetNodeId = oldEdge ? attachedNodeId(oldEdge.target) : null
        if (!nextEdge) continue

        const data = (nextEdge.data ?? {}) as Record<string, unknown>
        const sourceNodeId = attachedNodeId(nextEdge.source)
        const targetNodeId = attachedNodeId(nextEdge.target)
        const sourceNode = sourceNodeId ? store.getNode(sourceNodeId) : null
        const targetNode = targetNodeId ? store.getNode(targetNodeId) : null
        const validReference = sourceNode !== null
          && sourceNode !== undefined
          && targetNode?.type === "image-generator"
          && (sourceNode.type === "image" || sourceNode.type === "image-generator")

        let referenceData: Record<string, unknown> | null = null
        if (canEdit && !local && validReference && sourceNodeId && targetNodeId) {
          const duplicate = orderedImageReferences(store, targetNodeId).some(
            (reference) => reference.edge.id !== edgeId
              && reference.sourceNodeId === sourceNodeId,
          )
          if (duplicate) {
            if (op.type === "edge.add") {
              store.removeEdge(edgeId)
            } else if (op.type === "edge.update") {
              store.updateEdge(edgeId, op.prev)
            }
            continue
          }
          const targetChanged = op.type === "edge.update" && oldTargetNodeId !== targetNodeId
          if (
            targetChanged
            || data.imageReference !== true
            || readImageReferenceOrdinal(data) === null
          ) {
            referenceData = {
              imageReference: true,
              imageReferenceOrdinal: nextImageReferenceOrdinal(store, targetNodeId, edgeId),
            }
          }
        } else if (canEdit && !local && data.imageReference === true && !validReference) {
          referenceData = {
            imageReference: null,
            imageReferenceOrdinal: null,
          }
        }

        if (op.type === "edge.update") {
          if (!referenceData) continue
          store.updateEdge(edgeId, {
            data: {
              ...data,
              ...referenceData,
            },
          })
          continue
        }

        const wantedParentId = rootId ?? undefined
        const scopeMismatched =
          data.graphUid !== boardId || data.parentId !== wantedParentId

        const existingStored = data._storedColors as StoredEdgeColors | undefined
        const currentStyle = nextEdge.style ?? {}
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

        store.updateEdge(edgeId, patch)
      }
    })
    return () => {
      unsubscribe()
      if (store.addEdge === guardedAddEdge) store.addEdge = originalAddEdge
      if (store.updateEdge === guardedUpdateEdge) store.updateEdge = originalUpdateEdge
      if (store.removeEdge === guardedRemoveEdge) store.removeEdge = originalRemoveEdge
    }
  }, [store, boardId, rootId, canEdit, local])
}
