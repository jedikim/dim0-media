import { Fragment } from "react"
import { CaretRightIcon } from "@phosphor-icons/react"
import { trimText } from "@/lib/common"
import { UNTITLED_LABEL } from "../../const"
import type { Note } from "../../types/note"


interface Props {
  /** Ancestor notes leading up to (but excluding) the current page. */
  ancestors: Note[]
  /** Called when the user clicks an ancestor segment. */
  onSegmentClick: (id: string) => void
}


/**
 * Breadcrumb shown above the current sheet's title. Each segment is the
 * label of an ancestor (top-most → closest); clicking jumps to that page
 * via the host-supplied callback. Renders nothing when the page is
 * top-level.
 */
export function SheetBreadcrumb({ ancestors, onSegmentClick }: Props) {
  if (ancestors.length === 0) return null

  return (
    <nav
      className="flex items-center gap-1 text-[11px] text-muted-foreground"
      aria-label="Breadcrumb"
    >
      {ancestors.map((note, i) => {
        const fullLabel = note.label?.markdown?.trim() || UNTITLED_LABEL
        return (
          <Fragment key={note.id}>
            <button
              type="button"
              onClick={() => onSegmentClick(note.id)}
              title={fullLabel}
              className="truncate max-w-[160px] rounded px-0.5 hover:text-foreground hover:underline"
            >
              {trimText(fullLabel, 24)}
            </button>
            {i < ancestors.length - 1 && (
              <CaretRightIcon className="size-3 shrink-0 opacity-60" />
            )}
          </Fragment>
        )
      })}
      <CaretRightIcon className="size-3 shrink-0 opacity-60" />
    </nav>
  )
}
