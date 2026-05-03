import { useMemo } from "react"
import { useShallow } from "zustand/shallow"
import { useChatStore } from "../store/chat-store"
import { useGraphStore } from "@/features/board/store/graph-store"
import type { NoteNode } from "@/features/board/types/flow"
import { buildContextTextFromNodes } from "@/features/board/utils/context-text"


const EMPTY_SELECTED_NODES: NoteNode[] = []
const MAX_MESSAGE_CONTEXT_CHARS = 12000


/**
 * Derives the per-message board-selection context that gets attached to the
 * agent payload. Reads selected nodes from the graph store (excluding point
 * nodes), respects the `enableMessageBoardContextSelection` user preference,
 * and truncates the rendered text to a hard cap so a few large notes can't
 * blow past the model context window. Surfaces that don't represent a board
 * (e.g. the standalone chat route) can pass `enabled: false` to short-circuit.
 */
export const useMessageContext = (
  { enabled = true }: { enabled?: boolean } = {}
): { messageContext: string | undefined; selectedNodeCount: number } => {
  const enableMessageBoardContextSelection = useChatStore(
    (state) => state.enableMessageBoardContextSelection
  )

  const selectedNodes = useGraphStore(
    useShallow((state) => {
      if (!enabled) return EMPTY_SELECTED_NODES
      return state.nodes.filter(
        (node) =>
          node.selected &&
          (node.data as { kind?: string } | undefined)?.kind !== "point"
      )
    })
  )

  const messageContext = useMemo(() => {
    if (!enabled || !enableMessageBoardContextSelection || selectedNodes.length === 0) {
      return undefined
    }
    const contextText = buildContextTextFromNodes(selectedNodes).trim()
    if (!contextText) return undefined
    return contextText.slice(0, MAX_MESSAGE_CONTEXT_CHARS)
  }, [enabled, enableMessageBoardContextSelection, selectedNodes])

  return { messageContext, selectedNodeCount: selectedNodes.length }
}
