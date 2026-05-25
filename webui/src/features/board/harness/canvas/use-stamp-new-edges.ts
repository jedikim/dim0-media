import { useEffect } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import {
  adaptEdgeColors,
  applyColorsToEdgeStyle,
  pickStoredEdgeColors,
} from "../theme/color-adapter"
import { getBoardThemeMode } from "../theme/theme-mode-ref"


/**
 * Stamp identity + dark-mode bookkeeping onto edges created by the
 * lib's arrow tool. Canvas-harness's `useArrowTool` calls
 * `store.addEdge` with no `data` field, which means newly-drawn edges
 * have no parent_id when persisted (so an edge drawn inside a
 * sub-folder would appear at the root board) and no `_storedColors`
 * (so a theme toggle later wouldn't have a source-of-truth to project
 * from).
 *
 * This subscriber:
 *  - sets `version` / `createdAt` / `graphUid` / `parentId`
 *  - captures the edge's freshly-applied style (which arrowDefaults
 *    seeded from sticky style memory) as `_storedColors` — what the
 *    user picked
 *  - in dark mode, replaces `edge.style.{stroke,text}Color` with the
 *    dark-adapted projection so the new edge paints consistently
 *
 * Hydrated edges already carry `version` via the convert layer, so we
 * skip them.
 *
 * Mirrors prod's [line-placement.ts](dim0/.../line-placement.ts)
 * which sets `parentId: rootId` directly at construction time.
 */
export const useStampNewEdges = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
): void => {
  useEffect(() => {
    if (!boardId) return
    return store.subscribe("change", (batch) => {
      if (batch.origin !== "local") return
      for (const op of batch.ops) {
        if (op.type !== "edge.add") continue
        const data = (op.edge.data ?? {}) as Record<string, unknown>
        // Skip edges already stamped by the convert layer (hydration /
        // applyBatch from an agent) — they always carry `version`.
        if (data.version !== undefined) continue

        const style = op.edge.style ?? {}
        const storedColors = pickStoredEdgeColors(style)
        const mode = getBoardThemeMode()
        const nextStyle =
          mode === "dark"
            ? applyColorsToEdgeStyle(style, adaptEdgeColors(storedColors, "dark"))
            : style

        store.updateEdge(op.edge.id, {
          style: nextStyle,
          data: {
            ...data,
            version: 1,
            createdAt: new Date().toISOString(),
            graphUid: boardId,
            parentId: rootId ?? undefined,
            _storedColors: storedColors,
          },
        })
      }
    })
  }, [store, boardId, rootId])
}
