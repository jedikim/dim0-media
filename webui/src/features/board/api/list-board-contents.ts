import { useQuery } from "@tanstack/react-query"
import camelcaseKeys from "camelcase-keys"
import { apiFetch } from "@/api"


export type BoardContentKind = "sheet" | "folder" | "code-sandbox" | "widget"


export interface BoardContentItem {
  id: string
  label?: string | null
  kind: BoardContentKind
  parentId?: string | null
}


interface ListBoardContentsResponse {
  data: {
    items: Array<{
      id: string
      label?: string | null
      kind: BoardContentKind
      parent_id?: string | null
    }>
  }
}


/**
 * Fetch the surface-kind nodes (sheet/folder/code-sandbox/widget) of a board
 * at a single hierarchy level.
 */
export async function listBoardContents(
  boardId: string,
  parentId?: string,
): Promise<BoardContentItem[]> {
  const res = await apiFetch<ListBoardContentsResponse>({
    path: `/boards/${boardId}/contents`,
    method: "GET",
    params: parentId ? { parent_id: parentId } : {},
  })
  return res.data.items.map((item) => camelcaseKeys(item, { deep: true })) as BoardContentItem[]
}


/**
 * React Query hook for one level of a board's contents tree.
 * Pass `enabled: false` until the user expands a folder so we don't fetch eagerly.
 */
export const useBoardContents = (
  boardId: string,
  parentId: string | undefined,
  options: { enabled?: boolean } = {},
) => {
  const { enabled = true } = options
  return useQuery<BoardContentItem[]>({
    queryKey: ["boardContents", boardId, parentId ?? "root"],
    queryFn: () => listBoardContents(boardId, parentId),
    enabled: enabled && Boolean(boardId),
    staleTime: 1000 * 60 * 5,
  })
}
