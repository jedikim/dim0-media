import { useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "@/api"
import { useAppStore } from "@/store"
import type { Graph } from "../types/board"


/**
 * Auto-label a board by summarizing one of its chats.
 * Server-side guards against overwriting a label that's already set.
 */
export async function describeBoard({
  boardId,
  chatId,
}: {
  boardId: string
  chatId: string
}): Promise<string | null> {
  const res = await apiFetch<{ data: { label: string | null } }>({
    path: `/boards/${boardId}:describe`,
    method: "POST",
    params: { chat_id: chatId },
  })
  return res.data.label
}


/**
 * Mutation hook that triggers board auto-labeling and patches the cached
 * boards list with the resulting label so the sidebar updates immediately.
 */
export const useDescribeBoard = () => {
  const queryClient = useQueryClient()
  const userId = useAppStore((s) => s.userId)

  const mutation = useMutation({
    mutationFn: describeBoard,
    onSuccess: (label, variables) => {
      if (!label) return
      queryClient.setQueryData(["listBoards", userId], (oldBoards: Graph[] | undefined) => (
        oldBoards?.map((board) => (
          board.uid === variables.boardId ? { ...board, label } : board
        ))
      ))
    },
  })

  return {
    describeBoard: mutation.mutate,
    describeBoardAsync: mutation.mutateAsync,
    ...mutation,
  }
}
