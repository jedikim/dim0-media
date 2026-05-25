import { useCallback } from "react"
import { screenToWorld, type CanvasStore, type NodeId } from "@canvas-harness/core"
import {
  createDefaultNote,
  DEFAULT_SLIDE_HEIGHT,
  DEFAULT_SLIDE_WIDTH,
} from "@/features/board/types/note"
import { noteToNode } from "../convert/note-to-node"


/**
 * Compute the viewport center in world coords. Fallback `{0,0}` if
 * the wrap isn't measurable yet (rare; early mount).
 */
const viewportCenterWorld = (
  wrap: HTMLElement | null,
  store: CanvasStore,
): { x: number; y: number } => {
  if (!wrap) return { x: 0, y: 0 }
  const rect = wrap.getBoundingClientRect()
  return screenToWorld(
    { x: rect.width / 2, y: rect.height / 2 },
    store.getCamera(),
  )
}


/**
 * Insert a new slide (canvas-harness frame) at the current viewport
 * center. Returns the new node id, or `null` when scope is missing.
 *
 * Used by the Slides panel's "Add Slide" button — immediate creation
 * matches prod's UX. The arrow / shape tools still let you drag-create
 * frames manually if needed.
 */
export const useHarnessAddFrame = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
  wrapRef: React.RefObject<HTMLElement | null> | null,
) => {
  return useCallback((): NodeId | null => {
    if (!boardId) return null
    const note = createDefaultNote({ boardId, nodeType: "slide" })
    if (rootId) note.parentId = rootId
    const center = viewportCenterWorld(wrapRef?.current ?? null, store)
    note.properties.nodePosition = {
      type: "position",
      position: {
        x: center.x - DEFAULT_SLIDE_WIDTH / 2,
        y: center.y - DEFAULT_SLIDE_HEIGHT / 2,
      },
    }
    note.properties.nodeSize = {
      type: "size",
      size: { width: DEFAULT_SLIDE_WIDTH, height: DEFAULT_SLIDE_HEIGHT },
    }
    const node = noteToNode(note)
    store.addNode(node)
    return node.id as NodeId
  }, [store, boardId, rootId, wrapRef])
}
