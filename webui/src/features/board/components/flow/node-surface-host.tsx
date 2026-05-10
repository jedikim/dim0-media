import { memo, useEffect } from "react"

import { useGraphStore } from "../../store/graph-store"
import { CodeSandboxPanel } from "./code-sandbox-panel"
import { SheetNodePanel } from "./sheet-node-panel"
import { WidgetPanel } from "./widget-panel"


/**
 * Mounts the currently active rich node surface once at board level.
 *
 * Sheets are special: a sub-page is a note whose `parent_id` points at
 * another note rather than living on the canvas, so it never appears in
 * `nodesById`. The sheet panel handles loading from the API for that
 * case, so we always mount it and let the panel gate on its own data.
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

  // Backdrop dim. Sits just below the panel (z-[54] vs z-[55]) and above
  // the chrome (z-50). Click-through anywhere outside the panel closes it.
  const overlay = (
    <div
      className="absolute inset-0 z-[54] bg-background/50 backdrop-blur-sm"
      onClick={closeNodeSurface}
      aria-hidden="true"
    />
  )

  if (activeNodeSurface.kind === "sheet") {
    return (
      <>
        {overlay}
        <SheetNodePanel nodeId={activeNodeSurface.nodeId} />
      </>
    )
  }

  if (!hasNode) return null

  if (activeNodeSurface.kind === "widget") {
    return (
      <>
        {overlay}
        <WidgetPanel nodeId={activeNodeSurface.nodeId} />
      </>
    )
  }

  return (
    <>
      {overlay}
      <CodeSandboxPanel nodeId={activeNodeSurface.nodeId} />
    </>
  )
})
