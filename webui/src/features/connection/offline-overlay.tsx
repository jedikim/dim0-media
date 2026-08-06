import { useBoardOfflineStatus } from "@/features/board/api/board-offline-status"
import { useConnectionStatus } from "./connection-state"


/**
 * Blocking "can't reach the server" modal — but only when it must block.
 *
 * When offline on a synced board that's already available offline, the app stays
 * fully usable (the local replica serves reads + queues edits), so this renders
 * NOTHING and the top-right `ConnectionIndicator` carries the offline signal
 * instead. It only blocks when the current view genuinely needs the server: a
 * board not yet downloaded to this device, or a non-board route (dashboard, etc.).
 *
 * The detector's own backoff loop unfreezes the app automatically as soon as a
 * ping succeeds — there's no manual "retry" button by design (a button would
 * race the loop and just trigger an extra ping).
 */
export const OfflineOverlay = ({ boardId }: { boardId: string | null }) => {
  const status = useConnectionStatus()
  // Cheap local idb read; disabled (no boardId) → `data` stays undefined.
  const { data: boardOffline } = useBoardOfflineStatus(boardId ?? "")
  if (status !== "offline") return null
  if (boardId) {
    // Still resolving the idb read — don't flash the block on a board that turns
    // out to be offline-available; and once known available, don't block at all.
    if (boardOffline === undefined || boardOffline) return null
  }

  const boardMissing = Boolean(boardId)
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="mx-4 max-w-md rounded-xl border border-border bg-background p-6 text-center shadow-lg">
        <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <span
            aria-hidden="true"
            className="block h-3 w-3 animate-pulse rounded-full bg-destructive"
          />
        </div>
        <h2 className="text-base font-semibold text-foreground">
          {boardMissing ? "This board isn't available offline" : "Can't reach the Dim0 server"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {boardMissing
            ? "You're offline and this board hasn't been downloaded to this device. It'll open automatically once you're back online."
            : "Check your internet connection. We'll reconnect automatically as soon as the server is reachable again."}
        </p>
      </div>
    </div>
  )
}
