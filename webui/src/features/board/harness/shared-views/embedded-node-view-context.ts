import { createContext, useContext } from "react"


/**
 * True when a custom node's React view is mounted inside an embedded
 * surface (e.g. Files view cards) where the parent already owns drag
 * + selection. In that case the inner `NodeDragHandle` suppresses
 * itself so the card doesn't show two stacked grip icons.
 *
 * Provider lives in `embedded-node-view-provider.tsx`; this file holds
 * the context object + read hook so fast-refresh treats the JSX
 * module as component-only.
 */
export const EmbeddedNodeViewCtx = createContext<boolean>(false)


export const useIsEmbeddedNodeView = (): boolean => useContext(EmbeddedNodeViewCtx)
