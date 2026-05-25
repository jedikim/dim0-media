import { useCallback, type ReactNode } from "react"
import type { NodeId } from "@canvas-harness/core"
import { useCanvasStore } from "@canvas-harness/react"
import { CodeSandboxView } from "./code-sandbox"
import { DocumentView } from "./document"
import { FolderView } from "./folder"
import { SheetView } from "./sheet"
import { WidgetView } from "./widget"


/**
 * Type → React view component map. Mounted directly inside `<Canvas
 * renderCustomNodeView>`. Subscribing per-id happens inside each view
 * via `useNode(id)` so live updates propagate without a re-render at
 * this router level (see migration plan §4.1 "Subscription gotcha").
 */
const VIEW_REGISTRY: Readonly<Record<string, (props: { id: NodeId }) => ReactNode>> = {
  folder: FolderView,
  document: DocumentView,
  widget: WidgetView,
  "code-sandbox": CodeSandboxView,
  sheet: SheetView,
}


/**
 * Hook that returns the `renderCustomNodeView` function to feed into
 * `<Canvas>`. Dispatches by `node.type`; falls through to `null` for
 * unknown / built-in types (those don't need a React view).
 */
export const useRenderCustomNodeView = (): ((id: NodeId) => ReactNode) => {
  const store = useCanvasStore()
  return useCallback(
    (id: NodeId): ReactNode => {
      const node = store.getNode(id)
      if (!node) return null
      const View = VIEW_REGISTRY[node.type]
      return View ? <View id={id} /> : null
    },
    [store],
  )
}
