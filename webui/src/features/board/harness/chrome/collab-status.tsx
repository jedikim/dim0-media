import { cn } from "@/lib/utils"
import { useCollabConnState } from "../canvas/collab-reconnect"


type StatusKey = "idle" | "connecting" | "live" | "reconnecting" | "failed" | "room-full"


const STATUS_LABEL: Record<StatusKey, string> = {
  idle: "",
  connecting: "Connecting…",
  live: "",
  reconnecting: "Reconnecting…",
  failed: "Disconnected — refresh to retry",
  "room-full": "Board is full — try again later",
}


const STATUS_CLASS: Record<StatusKey, string> = {
  idle: "",
  connecting: "text-muted-foreground",
  live: "",
  reconnecting: "text-amber-600 dark:text-amber-400",
  failed: "text-destructive",
  "room-full": "text-amber-600 dark:text-amber-400",
}


/**
 * Collab WS status pill. Hidden during normal operation (`idle`, `live`)
 * so it doesn't squat in the chrome; surfaces during transitions
 * (`connecting` on first open, `reconnecting` during backoff) and
 * after max-attempts (`failed`).
 *
 * Layout owned by the caller — sits next to the save-status pill in
 * `harness-canvas.tsx`.
 */
export function HarnessCollabStatus() {
  const state = useCollabConnState()
  const label = STATUS_LABEL[state]
  if (!label) return null
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-background/95 px-2 py-1 text-xs shadow-sm backdrop-blur [.tauri-webkit_&]:backdrop-blur-none",
        STATUS_CLASS[state],
      )}
      aria-live="polite"
      role="status"
    >
      {label}
    </div>
  )
}
