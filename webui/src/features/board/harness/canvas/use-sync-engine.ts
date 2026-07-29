/**
 * Resolve which collab client a synced board mounts: the offline-first
 * coordinator (`v2`) or the legacy `use-ws-collab` (`legacy`).
 *
 * Source of truth is the board's `BoardMeta.syncEngine` (persisted in the local
 * registry). The `dim0SyncV2` localStorage flag stays as a dev/testing override
 * that forces v2 on any board — it wins over the stored engine. A board with no
 * local meta and no override resolves to `v2` (the default as of Phase 1 of the
 * backend-agent retirement); a board can still be pinned to the legacy client
 * with an explicit `syncEngine: "legacy"` (an escape hatch during rollout).
 */
import { useEffect, useState } from "react"
import type { BoardMeta } from "@/features/board/model"
import { getLocalStores } from "@/features/local-stores"
import { isBoardSyncV2 } from "../sync/sync-engine-flag"


export type SyncEngine = "legacy" | "v2"


/** Pure engine resolution: dev override wins, else stored engine, else v2 (default). */
export const resolveSyncEngine = (
  meta: BoardMeta | undefined,
  devOverride: boolean,
): SyncEngine => (devOverride ? "v2" : (meta?.syncEngine ?? "v2"))


/**
 * Resolve a synced board's engine, reading `BoardMeta` from the local registry.
 * Returns `null` while resolving (and always for `local-only` boards, which
 * don't run a collab client) so callers can defer mounting until the choice is
 * known — avoids briefly mounting the legacy client then swapping to v2.
 */
export const useSyncEngine = (
  boardId: string | null,
  local: boolean,
): SyncEngine | null => {
  const [engine, setEngine] = useState<SyncEngine | null>(null)

  useEffect(() => {
    if (local || !boardId) {
      setEngine(null)
      return
    }
    // Dev override is synchronous — no registry read needed.
    if (isBoardSyncV2(boardId)) {
      setEngine("v2")
      return
    }
    let cancelled = false
    setEngine(null)
    void getLocalStores()
      .then((stores) => stores.boards.getBoard(boardId))
      .then((meta) => {
        if (!cancelled) setEngine(resolveSyncEngine(meta, false))
      })
      .catch(() => {
        if (!cancelled) setEngine("v2") // default engine; consistent with resolveSyncEngine
      })
    return () => {
      cancelled = true
    }
  }, [boardId, local])

  return engine
}
