import { cn } from "@/lib/utils"
import type { SaveStatus } from "../persist/use-debounced-save"


const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  pending: "Edited",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
}


const STATUS_CLASS: Record<SaveStatus, string> = {
  idle: "",
  pending: "text-amber-600 dark:text-amber-400",
  saving: "text-muted-foreground",
  saved: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
}


/**
 * Top-right floating save-status pill. Empty render when idle so the
 * pill disappears between edits instead of squatting "Saved" forever.
 */
export function HarnessSaveStatus({ status }: { status: SaveStatus }) {
  const label = STATUS_LABEL[status]
  if (!label) return null
  return (
    <div
      className={cn(
        "absolute right-3 top-3 z-50 rounded-md border border-border bg-background/95 px-2 py-1 text-xs shadow-sm backdrop-blur",
        STATUS_CLASS[status],
      )}
      aria-live="polite"
    >
      {label}
    </div>
  )
}
