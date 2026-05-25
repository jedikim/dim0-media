import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { Graph } from "../types/board"
import { apiFetch } from "@/api"
import { useAppStore } from "@/store"
import { useBoardAppStore } from "../harness/store/board-app-store"
import { listBoards } from "./list-boards"
import { FREE_PLAN_BOARD_LIMIT, isBoardCreationLimited } from "../lib/board-limit"
import { toast } from "sonner"


/**
 * Create a new board for the user.
 */
export async function createBoard(): Promise<string> {
  const res = await apiFetch<{ data: { graph_id: string } }>({
    path: "/boards",
    method: "PUT"
  })
  return res.data.graph_id
}


/**
 * Custom hook to create a new board for the user.
 *
 * @returns An object containing the createBoard function and its mutation state.
 */
export const useCreateBoard = () => {
  const queryClient = useQueryClient()
  const userId = useAppStore(s => s.userId)
  const userPlan = useAppStore(s => s.userPlan)

  const setBoardScope = useBoardAppStore((s) => s.setBoardScope)

  const mutation = useMutation({
    mutationFn: async () => {
      const cachedBoards = queryClient.getQueryData<Graph[]>(["listBoards", userId])
      const boards = cachedBoards ?? await listBoards()

      if (isBoardCreationLimited(userPlan, boards.length)) {
        toast.error(`Free plan allows ${FREE_PLAN_BOARD_LIMIT} boards. Upgrade to Plus for unlimited limits, or self-host for your own unlimited setup.`)
        throw new Error("board_limit_reached")
      }

      const boardId = await createBoard()
      queryClient.setQueryData(["listBoards", userId], (oldBoards: Graph[] | undefined) => {
        const newBoard = { uid: boardId } as Graph // Temporary ID until the server responds
        return [newBoard, ...(oldBoards || [])] // Prepend the new board to the list
      })
      // Pre-set the harness scope so subsequent navigation onto /boards/:id
      // hydrates the new (empty) board without a flash.
      setBoardScope({ boardId, rootId: null })
      return boardId
    }
  })

  return {
    createBoard: mutation.mutate,
    createBoardAsync: mutation.mutateAsync,
    ...mutation
  }
}
