import type { QueryClient } from "@tanstack/react-query"
import { queryClient as defaultQueryClient } from "@/query-client"


/**
 * Invalidate cached `listBoardContents` queries so the sidebar tree (and
 * anything else consuming `useBoardContents`) refetches the affected
 * level. Without `parentId`, every level under the board is invalidated —
 * cheap because each level only refetches if a consumer is currently
 * mounted (and lazy-loaded leaves stay untouched until expanded).
 */
export function invalidateBoardContents(
  boardId: string | undefined,
  parentId?: string | undefined,
  client: QueryClient = defaultQueryClient,
): void {
  if (!boardId) return
  if (parentId === undefined) {
    void client.invalidateQueries({ queryKey: ["boardContents", boardId] })
    return
  }
  void client.invalidateQueries({
    queryKey: ["boardContents", boardId, parentId ?? "root"],
  })
}
