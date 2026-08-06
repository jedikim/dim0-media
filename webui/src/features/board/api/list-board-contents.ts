import { useQuery } from "@tanstack/react-query"
import camelcaseKeys from "camelcase-keys"
import { apiFetch } from "@/api"
import type { IconProperty } from "@/features/newsfeed/types/properties"


export type BoardContentKind = "sheet" | "folder" | "code-sandbox" | "widget"


export interface BoardContentItem {
  id: string
  label?: string | null
  kind: BoardContentKind
  parentId?: string | null
  /**
   * Inner icon value (no IconProperty wrapper). `null` / absent when the
   * user hasn't picked an icon; sidebar / list-view consumers should fall
   * back to a kind-default icon in that case.
   */
  iconData?: IconProperty["icon"] | null
}


interface ListBoardContentsResponse {
  data: {
    items: Array<{
      id: string
      label?: string | null
      kind: BoardContentKind
      parent_id?: string | null
      icon_data?: IconProperty["icon"] | null
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
 *
 * NOTE: no component consumes this anymore — the sidebar tree migrated to the
 * on-device store (`useLocalBoardContents` + `useSidebarContentsSync`). The REST
 * `/contents` path (this hook, `invalidateBoardContents`, and the `boardContents`
 * cache patches in sheet-panel / node-title-caption) is now unused by the tree
 * and is a candidate for removal in a follow-up sweep. `listBoardContents` (the
 * raw fn) is still used by the editor's page-provider.
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
