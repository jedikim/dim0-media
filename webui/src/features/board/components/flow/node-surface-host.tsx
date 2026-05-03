import { memo, useEffect } from "react"

import { useGraphStore } from "../../store/graph-store"
import { CodeSandboxDialog } from "./code-sandbox-dialog"
import { SheetNodeDialog } from "./sheet-node-dialog"
import { WidgetDialog } from "./widget-dialog"


/**
 * Mounts the currently active rich node surface once at board level.
 *
 * Sheets are special: a sub-page is a note whose `parent_id` points at
 * another note rather than living on the canvas, so it never appears in
 * `nodesById`. The sheet dialog handles loading from the API for that
 * case, so we always mount it and let the dialog gate on its own data.
 * Widgets and code-sandbox surfaces remain canvas-only.
 */
export const NodeSurfaceHost = memo(function NodeSurfaceHost() {
  const activeNodeSurface = useGraphStore((state) => state.activeNodeSurface)
  const hasNode = useGraphStore((state) =>
    activeNodeSurface ? state.nodesById.has(activeNodeSurface.nodeId) : false,
  )
  const closeNodeSurface = useGraphStore((state) => state.closeNodeSurface)

  useEffect(() => {
    if (!activeNodeSurface) return
    // Auto-close only for canvas-bound surfaces; sheets may be sub-pages.
    if (activeNodeSurface.kind !== "sheet" && !hasNode) {
      closeNodeSurface()
    }
  }, [activeNodeSurface, closeNodeSurface, hasNode])

  if (!activeNodeSurface) return null

  if (activeNodeSurface.kind === "sheet") {
    return <SheetNodeDialog nodeId={activeNodeSurface.nodeId} />
  }

  if (!hasNode) return null

  if (activeNodeSurface.kind === "widget") {
    return <WidgetDialog nodeId={activeNodeSurface.nodeId} />
  }

  return <CodeSandboxDialog nodeId={activeNodeSurface.nodeId} />
})
