import { NotepadIcon } from "@phosphor-icons/react"
import { IconPropertyView } from "@/components/icons/icon-property-view"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import type { Page } from "./types"


interface Props {
  /**
   * Resolved page from the page-cache. `undefined` = still loading,
   * `null` = page is deleted / inaccessible, otherwise live data.
   */
  cached: Page | null | undefined
  /** Title snapshot from the markdown — used while loading or if deleted. */
  fallbackTitle: string
  children: React.ReactNode
}


/**
 * Hover preview for a page reference (inline chip or block subpage).
 * Uses the parent's already-resolved page-cache data so we don't fire an
 * extra fetch — the chip's NodeView already subscribes/refreshes.
 */
export function PageHoverCard({ cached, fallbackTitle, children }: Props) {
  const isLoading = cached === undefined
  const isDeleted = cached === null
  const liveTitle = cached?.title?.trim()
  const title = liveTitle || fallbackTitle
  const snippet = cached?.snippet?.trim()
  const icon = cached?.icon ?? null

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-72 p-3"
      >
        <div className="flex items-start gap-2">
          {icon ? (
            <span className="shrink-0 mt-0.5">
              <IconPropertyView icon={icon} size={18} />
            </span>
          ) : (
            <NotepadIcon
              size={18}
              weight="duotone"
              className="shrink-0 mt-0.5 text-muted-foreground"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">
              {isDeleted ? `${title} (deleted)` : title}
            </p>
            {isDeleted ? (
              <p className="mt-1 text-xs italic text-muted-foreground">
                No longer accessible.
              </p>
            ) : isLoading ? (
              <p className="mt-1 text-xs italic text-muted-foreground">
                Loading…
              </p>
            ) : snippet ? (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                {snippet}
              </p>
            ) : (
              <p className="mt-1 text-xs italic text-muted-foreground">
                Empty page
              </p>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
