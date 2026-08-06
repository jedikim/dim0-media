import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { getLocalStores } from "@/features/local-stores"
import { materializeBoardOffline } from "@/features/board/persist/local/materialize-board"
import type { SnapshotRecord } from "@/features/board/persist/local/idb"


/** React Query key for a board's offline-availability status. */
export const boardOfflineKey = (boardId: string) => ["boardOffline", boardId] as const


/** Whether a synced board's whole-board base is persisted locally (readable offline). */
export async function isBoardAvailableOffline(boardId: string): Promise<boolean> {
  const { engine } = await getLocalStores()
  return Boolean(await engine.get<SnapshotRecord>("snapshots", boardId))
}


/**
 * Whether a synced board is available offline. A cheap `snapshots`-row check,
 * keyed per board so `useDownloadBoard` (and the sync coordinator's auto-seed on
 * open) can flip it by invalidating this key.
 */
export function useBoardOfflineStatus(boardId: string) {
  return useQuery({
    queryKey: boardOfflineKey(boardId),
    queryFn: () => isBoardAvailableOffline(boardId),
    enabled: Boolean(boardId),
    staleTime: 1000 * 30,
  })
}


/**
 * Download a synced board for offline use (whole board, all layers) and refresh
 * its offline status. `materializeBoardOffline` is idempotent + best-effort — a
 * rejection (e.g. offline: can't reach the server) surfaces a toast so the click
 * isn't a silent no-op.
 */
export function useDownloadBoard() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (boardId: string) => materializeBoardOffline(boardId),
    onSuccess: (_wrote, boardId) => {
      void client.invalidateQueries({ queryKey: boardOfflineKey(boardId) })
    },
    onError: () => toast.error("Couldn't download this board for offline use. Check your connection."),
  })
}
