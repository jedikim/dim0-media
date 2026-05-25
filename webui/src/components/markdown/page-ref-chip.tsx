import { Notepad } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"


export type PageRefChipProps = {
  /** Title snapshot from the markdown — what the chip displays. */
  title: string
  /** Optional click handler. Read-only contexts (no provider) pass nothing. */
  onClick?: () => void
}


/**
 * Read-only page reference chip used by MarkdownView. Mirrors the
 * TipTap PageRefView visual (`@ + notepad + title`) but doesn't
 * resolve the live title — the snapshot in the markdown is the
 * source of truth. The TipTap editor re-emits the link with a fresh
 * title whenever the user edits, so cards stay roughly in sync.
 */
export function PageRefChip({ title, onClick }: PageRefChipProps) {
  const interactive = typeof onClick === "function"
  return (
    <span
      className={cn(
        "inline-flex select-none items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5",
        "text-sm font-medium text-foreground/90",
        interactive && "cursor-pointer transition-colors hover:bg-muted hover:text-foreground",
      )}
      onClick={onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <span aria-hidden="true" className="text-muted-foreground">@</span>
      <Notepad size={14} weight="duotone" className="shrink-0 text-muted-foreground" />
      <span>{title}</span>
    </span>
  )
}
