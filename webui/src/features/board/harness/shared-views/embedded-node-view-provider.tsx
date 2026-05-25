import type { ReactNode } from "react"
import { EmbeddedNodeViewCtx } from "./embedded-node-view-context"


/**
 * Wrap any custom-node React subtree with this when reusing the
 * view inside a non-canvas surface (Files cards, future previews).
 * Suppresses canvas-context-only chrome (the inner NodeDragHandle).
 */
export const EmbeddedNodeViewProvider = ({ children }: { children: ReactNode }) => (
  <EmbeddedNodeViewCtx.Provider value={true}>{children}</EmbeddedNodeViewCtx.Provider>
)
