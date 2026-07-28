import type { BoardMeta } from "@/features/board/model"
import type { BoardListItem } from "@/features/board/api/list-boards"
import { isSignedIn } from "@/lib/auth"


export type PartitionedBoards = {
  onDevice: BoardMeta[]
  synced: BoardListItem[]
}


/**
 * The local boards that belong under "On this device", newest first.
 *
 * A board is dropped if its id is already in the backend `synced` list — it
 * renders once, under "Synced" (this also covers the window right after promotion
 * where the backend has adopted the board but the local `kind` flip hasn't landed,
 * so it never shows twice). Of the rest:
 *  - `local-only` boards always belong here (truly device-local, no account).
 *  - a `synced` replica belongs here ONLY for its signed-in owner — the offline /
 *    pre-refetch fallback that keeps a promoted board reachable without a
 *    connection. It is hidden when signed out or under a different account, so a
 *    board that belongs to a user account never leaks into another session.
 *
 * `synced` may be undefined (signed out / not yet loaded). `userId` is the auth
 * sentinel — `"root"` when signed out (see `isSignedIn`).
 */
export const selectOnDeviceBoards = (
  local: BoardMeta[],
  synced: BoardListItem[] | undefined,
  userId: string,
): BoardMeta[] => {
  const syncedIds = new Set((synced ?? []).map((b) => b.uid))
  const signedIn = isSignedIn(userId)
  return local
    .filter((b) => {
      if (syncedIds.has(b.id)) return false
      if (b.kind === "local-only") return true
      return signedIn && b.ownerId === userId
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}


/**
 * Split the two board sources into the dashboard's groups, newest first.
 * See `selectOnDeviceBoards` for the on-device membership rule.
 */
export const partitionBoards = (
  local: BoardMeta[],
  synced: BoardListItem[] | undefined,
  userId: string,
): PartitionedBoards => {
  const sortedSynced = [...(synced ?? [])].sort(
    (a, b) => syncedTime(b) - syncedTime(a),
  )
  return { onDevice: selectOnDeviceBoards(local, synced, userId), synced: sortedSynced }
}


/** Epoch ms for a synced board's sort key (ISO strings from the backend). */
const syncedTime = (b: BoardListItem): number => {
  const raw = b.updatedAt ?? b.createdAt
  return raw ? new Date(raw).getTime() : 0
}
