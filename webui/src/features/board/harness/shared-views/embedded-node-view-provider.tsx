import { useMemo, type HTMLAttributes, type ReactNode } from "react"
import { EmbeddedNodeViewCtx } from "./embedded-node-view-context"


export type EmbeddedNodeViewProviderProps = {
  children: ReactNode
  /**
   * When provided, the inner `NodeTrafficLights` strip spreads these
   * onto its root — turning the strip into the embedded surface's
   * drag handle (e.g. dnd-kit `attributes` + `listeners` from Files).
   */
  dragHandleProps?: HTMLAttributes<HTMLElement>
}


/**
 * Wrap any custom-node React subtree with this when reusing the
 * view inside a non-canvas surface (Files cards, future previews).
 * The provider marks the subtree as embedded and optionally forwards
 * a drag handle so the inner traffic-lights strip can act as the
 * parent surface's drag affordance.
 */
export const EmbeddedNodeViewProvider = ({
  children,
  dragHandleProps,
}: EmbeddedNodeViewProviderProps) => {
  const value = useMemo(() => ({ dragHandleProps }), [dragHandleProps])
  return (
    <EmbeddedNodeViewCtx.Provider value={value}>
      {children}
    </EmbeddedNodeViewCtx.Provider>
  )
}
