import { WifiSlashIcon } from "@/components/icons"
import { useConnectionStatus } from "./connection-state"


/**
 * Top-right, non-blocking "you're offline" affordance. Renders only while the
 * connection-state detector reports `offline`. Unlike the OfflineOverlay it never
 * blocks: offline-available boards keep working, so this just signals why sync is
 * paused. Self-gating — a no-op online, and online is the default until the
 * detector (authed sessions only) reports otherwise.
 */
export const ConnectionIndicator = () => {
  const status = useConnectionStatus()
  if (status !== "offline") return null

  return (
    <span
      role="status"
      aria-live="polite"
      title="You're offline — changes sync once the connection returns"
      className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive"
    >
      <WifiSlashIcon className="size-4" strokeWidth={2} />
      <span className="hidden sm:inline">Offline</span>
    </span>
  )
}
