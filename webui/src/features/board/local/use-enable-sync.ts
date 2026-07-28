import { useCallback, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useAppStore } from "@/store"
import { isSignedIn } from "@/lib/auth"
import { getLocalStores } from "@/features/local-stores"
import { BoardPersistence } from "@/features/board/persist/local/board-persistence"
import { adoptBoard } from "@/features/board/api/adopt-board"
import { useListBoards } from "@/features/board/api/list-boards"
import {
  boardLimitForPlan,
  isBoardCreationLimited,
} from "@/features/board/lib/board-limit"
import { enableSync } from "@/features/board/harness/sync/enable-sync"
import type { EnableSyncResult } from "@/features/board/harness/sync/enable-sync"


/**
 * Promote a local board to synced (local → synced) from the dashboard.
 *
 * Wires the real deps to the `enableSync` orchestrator: a fresh BoardPersistence
 * for the snapshot + compaction, the adopt API, and the registry flip. Signed-out
 * users are routed to sign-in (a synced board needs an owner). On success it
 * invalidates the synced-board list so the card moves into the "Synced" group.
 * `pendingId` is the board mid-promotion (for a spinner / disabled state).
 */
export function useEnableSync() {
  const userId = useAppStore((s) => s.userId)
  const userPlan = useAppStore((s) => s.userPlan)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: syncedBoards = [] } = useListBoards(userId)
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Synchronous re-entry guard: `pendingId` is React state (updates next render),
  // so two rapid clicks (e.g. the sidebar cloud icon + the context-menu item)
  // could both pass the `syncing` gate and promote the same board twice. A ref
  // flips immediately, before the first `await`, closing that window.
  const inFlight = useRef<Set<string>>(new Set())

  const run = useCallback(
    async (boardId: string, label?: string): Promise<EnableSyncResult> => {
      // The logged-out userId is the sentinel "root" (truthy), so `!userId`
      // never catches it — gate on isSignedIn (a synced board needs an owner).
      if (!isSignedIn(userId)) {
        void navigate({ to: "/signin" })
        return { ok: false, reason: "signed-out" }
      }
      // The synced-board cap bites at promotion (boards are one-way). Count
      // OWNED synced boards; shared-with-me don't count against the owner's cap.
      const ownedSynced = syncedBoards.filter((b) => b.role === "owner").length
      if (isBoardCreationLimited(userPlan, ownedSynced)) {
        toast.error(
          `You're at your plan's synced-board limit (${boardLimitForPlan(userPlan)}). ` +
            "Upgrade, or delete a synced board — local boards stay unlimited.",
        )
        return { ok: false, reason: "limited" }
      }
      if (inFlight.current.has(boardId)) return { ok: false, reason: "in-flight" }
      inFlight.current.add(boardId)
      setPendingId(boardId)
      const stores = await getLocalStores()
      const persistence = new BoardPersistence(boardId, { engine: stores.engine })
      try {
        const result = await enableSync(boardId, {
          signedIn: true,
          ownerId: userId,
          capture: () => persistence.capture(),
          adopt: (ops) => adoptBoard(boardId, ops, label).then(() => undefined),
          foldBase: (content, seq) => persistence.foldBase(content, seq),
          markSynced: (ownerId) =>
            stores.boards.markSynced(boardId, { syncEngine: "v2", ownerId }),
        })
        if (result.ok) {
          await queryClient.invalidateQueries({ queryKey: ["listBoards", userId] })
          toast.success("Sync enabled — this board is now backed up and shareable.")
        } else {
          toast.error("Couldn't enable sync. Please try again.")
        }
        return result
      } finally {
        inFlight.current.delete(boardId)
        persistence.close()
        setPendingId(null)
      }
    },
    [userId, userPlan, syncedBoards, navigate, queryClient],
  )

  return { enableSync: run, pendingId }
}
