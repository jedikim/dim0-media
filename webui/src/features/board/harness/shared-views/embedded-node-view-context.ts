import { createContext, useContext, type HTMLAttributes } from "react"


export type EmbeddedNodeViewCtxValue = {
  /**
   * Drag-handle props (e.g. dnd-kit `attributes` + `listeners`) that
   * the inner `NodeTrafficLights` strip should spread onto its root.
   * Lets the strip act as the embedded surface's reorder drag handle
   * — same visual, different drag system.
   */
  dragHandleProps?: HTMLAttributes<HTMLElement>
} | null


/**
 * True when a custom node's React view is mounted inside an embedded
 * surface (e.g. Files view cards). The inner `NodeTrafficLights` strip
 * still renders, but its behavior is parameterised by the provider —
 * specifically the strip's drag handle plumbs through to whatever
 * gesture system the parent owns (dnd-kit in Files).
 *
 * Provider lives in `embedded-node-view-provider.tsx`; this file holds
 * the context object + read hooks so fast-refresh treats the JSX
 * module as component-only.
 */
export const EmbeddedNodeViewCtx = createContext<EmbeddedNodeViewCtxValue>(null)


export const useIsEmbeddedNodeView = (): boolean =>
  useContext(EmbeddedNodeViewCtx) !== null


export const useEmbeddedDragHandle = ():
  | HTMLAttributes<HTMLElement>
  | undefined => useContext(EmbeddedNodeViewCtx)?.dragHandleProps
