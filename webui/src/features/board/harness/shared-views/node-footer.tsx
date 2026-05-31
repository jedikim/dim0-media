import { type ReactNode } from "react"
import { cn } from "@/lib/utils"


export type NodeFooterStatus = "idle" | "pending" | "saving" | "saved" | "error"


export type NodeFooterProps = {
  /** Save state pill rendered on the right. */
  status?: NodeFooterStatus
  /** ISO timestamp of last edit. Formatted as a short relative string. */
  updatedAt?: string
  /** Left-aligned content (chips, badges, status descriptors). */
  children?: ReactNode
  className?: string
}


const STATUS_LABEL: Record<NodeFooterStatus, string> = {
  idle: "",
  pending: "Edited",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
}


const STATUS_CLASS: Record<NodeFooterStatus, string> = {
  idle: "text-muted-foreground",
  pending: "text-amber-600 dark:text-amber-400",
  saving: "text-muted-foreground",
  saved: "text-emerald-600 dark:text-emerald-400",
  error: "text-destructive",
}


/**
 * Footer chrome for custom node views — relative timestamp + save
 * status pill on the right, free-form children on the left.
 */
export function NodeFooter({ status, updatedAt, children, className }: NodeFooterProps) {
  const label = status ? STATUS_LABEL[status] : ""

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 border-t border-border/40 px-2 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 truncate">{children}</div>
      <div className="flex items-center gap-2">
        {updatedAt ? <span className="truncate">{formatRelative(updatedAt)}</span> : null}
        {label && status ? <span className={STATUS_CLASS[status]}>{label}</span> : null}
      </div>
    </div>
  )
}


/** Tiny relative-time helper. Avoids pulling in date-fns for one call site. */
const formatRelative = (iso: string): string => {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = Date.now() - t
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(t).toLocaleDateString()
}
