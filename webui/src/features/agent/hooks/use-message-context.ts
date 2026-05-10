import { useChatStore } from "../store/chat-store"
import { useGraphStore } from "@/features/board/store/graph-store"
import { buildContextTextFromNodes } from "@/features/board/utils/context-text"
import { queryClient } from "@/query-client"
import type { Note } from "@/features/board/types/note"
import type { NoteNode } from "@/features/board/types/flow"


const MAX_MESSAGE_CONTEXT_CHARS = 12000


/**
 * Read the active surface's note synchronously from wherever it lives —
 * the canvas store for on-canvas surfaces, the React Query cache for
 * sub-pages that never appear on the canvas.
 */
function readActiveSurfaceNote(noteId: string): Note | undefined {
  const localData = useGraphStore.getState().nodesById.get(noteId)?.data as Note | undefined
  if (localData) return localData
  const boardId = useGraphStore.getState().boardId
  if (!boardId) return undefined
  return queryClient.getQueryData<Note>(["note", boardId, noteId])
}


/**
 * Cheap reactive subscription that returns whether *any* selected non-point
 * node currently exists. Used by composer UIs to render a "selection
 * attached" indicator without iterating or allocating per-render.
 *
 * Selector returns a primitive boolean — zustand uses Object.is, no
 * useShallow allocation. some() short-circuits on the first match, so the
 * common case (something is selected) is effectively O(1) even on boards
 * with hundreds or thousands of nodes.
 */
export const useHasMessageContext = (
  { enabled = true }: { enabled?: boolean } = {},
): boolean => {
  const enableMessageBoardContextSelection = useChatStore(
    (state) => state.enableMessageBoardContextSelection,
  )
  const hasSelection = useGraphStore((state) =>
    enabled
      && state.nodes.some(
        (node) =>
          node.selected
            && (node.data as { kind?: string } | undefined)?.kind !== "point",
      ),
  )
  // The active page is *always* sent as context when a surface is open,
  // regardless of the selection toggle, so the indicator reflects that too.
  const hasActiveSurface = useGraphStore((state) => Boolean(state.activeNodeSurface))
  return enabled && (hasActiveSurface || (enableMessageBoardContextSelection && hasSelection))
}


/**
 * One-shot lazy builder for the per-message board-selection context. Reads
 * the current store state once, filters selected non-point nodes, renders
 * the context text, and truncates to a hard cap. Call from a submit handler
 * — never inside a render — so the heavy filter + text build only runs when
 * the user actually presses send.
 */
export const buildMessageContext = (
  { enabled = true }: { enabled?: boolean } = {},
): string | undefined => {
  if (!enabled) return undefined

  // When a surface is open, the active page replaces the canvas-selection
  // context entirely. The same note would otherwise also appear via its
  // root in nodesById, which would duplicate it (and confusingly mix two
  // formats). The active page is rendered through the same
  // `<SelectedNote>` block as canvas nodes for a single coherent format.
  const activeSurface = useGraphStore.getState().activeNodeSurface
  if (activeSurface) {
    const note = readActiveSurfaceNote(activeSurface.nodeId)
    if (!note) return undefined
    const synthetic = { id: note.id, data: note } as unknown as NoteNode
    const block = buildContextTextFromNodes([synthetic]).trim()
    if (!block) return undefined
    return block.slice(0, MAX_MESSAGE_CONTEXT_CHARS)
  }

  const enableMessageBoardContextSelection =
    useChatStore.getState().enableMessageBoardContextSelection
  if (!enableMessageBoardContextSelection) return undefined

  const selectedNodes = useGraphStore.getState().nodes.filter(
    (node) =>
      node.selected
        && (node.data as { kind?: string } | undefined)?.kind !== "point",
  )
  if (selectedNodes.length === 0) return undefined
  const text = buildContextTextFromNodes(selectedNodes).trim()
  if (!text) return undefined
  return text.slice(0, MAX_MESSAGE_CONTEXT_CHARS)
}
