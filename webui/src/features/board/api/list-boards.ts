import { useQuery } from "@tanstack/react-query"
import type { Graph } from "../types/board"
import camelcaseKeys from "camelcase-keys"
import { apiFetch } from "@/api"


/**
 * One row of the sidebar boards list. Extends the base Graph with the
 * user's per-board role (so the sidebar can split "My boards" vs
 * "Shared with me") and, for shared boards, the owner's email for a
 * tooltip hint.
 */
export type BoardListItem = Graph & {
  role: "owner" | "member" | "viewer"
  ownerEmail?: string
}


interface ListBoardsResponse {
  data: {
    graphs: Array<{
      uid: string
      type: "graph"
      label?: string
      readonly: boolean
      visibility: "private" | "public"
      thumbnail?: string
      created_at: string
      updated_at?: string
      deleted_at?: string
      role: "owner" | "member" | "viewer"
      owner_email?: string
    }>
  }
}


/**
 * List all boards for the user.
 *
 * Each row carries the user's per-board role so the sidebar can group
 * owned vs shared boards. `ownerEmail` is present on shared rows.
 */
export async function listBoards(): Promise<BoardListItem[]> {
  const res = await apiFetch<ListBoardsResponse>({
    path: "/boards",
    method: "GET",
  })
  return res.data.graphs.map((board) => camelcaseKeys(board, { deep: true })) as BoardListItem[]
}


/**
 * Custom hook to fetch the list of boards for a user.
 *
 * @param userId - The ID of the user whose boards are to be fetched.
 *
 * @returns A query object containing the list of boards.
 */
export const useListBoards = (userId: string) => {
  return useQuery<BoardListItem[]>({
    queryKey: ["listBoards", userId],
    queryFn: () => listBoards(),
    enabled: !!userId,
    staleTime: 1000 * 60 * 5 // 5 minutes
  })
}
