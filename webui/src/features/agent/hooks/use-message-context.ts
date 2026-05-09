import { useChatStore } from "../store/chat-store"
import { useGraphStore } from "@/features/board/store/graph-store"
import { buildContextTextFromNodes } from "@/features/board/utils/context-text"


const MAX_MESSAGE_CONTEXT_CHARS = 12000


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
  return enabled && enableMessageBoardContextSelection && hasSelection
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
  const enableMessageBoardContextSelection =
    useChatStore.getState().enableMessageBoardContextSelection
  if (!enableMessageBoardContextSelection) return undefined

  const selectedNodes = useGraphStore.getState().nodes.filter(
    (node) =>
      node.selected
        && (node.data as { kind?: string } | undefined)?.kind !== "point",
  )
  if (selectedNodes.length === 0) return undefined

  const contextText = buildContextTextFromNodes(selectedNodes).trim()
  if (!contextText) return undefined
  return contextText.slice(0, MAX_MESSAGE_CONTEXT_CHARS)
}
