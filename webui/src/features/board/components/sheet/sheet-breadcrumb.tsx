import { Fragment } from "react"
import { CaretRightIcon, DotsThreeIcon } from "@phosphor-icons/react"
import {
  FolderIcon,
  NotepadIcon,
  CodeFileIcon,
  StockWidgetIcon,
  type AppIconComponent,
} from "@/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { trimText } from "@/lib/common"
import { UNTITLED_LABEL } from "../../const"
import type { Note } from "../../types/note"


export type BreadcrumbSegmentKind = "folder" | "sheet" | "code-sandbox" | "widget" | "other"


function kindOf(note: Note): BreadcrumbSegmentKind {
  const t = note.style?.type
  if (t === "folder" || t === "sheet" || t === "code-sandbox" || t === "widget") return t
  return "other"
}


const ICON_BY_KIND: Record<BreadcrumbSegmentKind, AppIconComponent | null> = {
  folder: FolderIcon,
  sheet: NotepadIcon,
  "code-sandbox": CodeFileIcon,
  widget: StockWidgetIcon,
  other: null,
}


interface Props {
  /** Ancestor notes leading up to (but excluding) the current page. */
  ancestors: Note[]
  /** The current page itself — rendered as a trailing, non-clickable segment. */
  current?: Note
  /**
   * Called when the user clicks an ancestor segment. The host decides how
   * to navigate based on the segment's kind: folder → canvas inside the
   * folder, sheet/code/widget → that node's surface dialog.
   */
  onSegmentClick: (note: Note, kind: BreadcrumbSegmentKind) => void
}


/**
 * Breadcrumb shown above the current sheet's title. Each ancestor segment
 * carries a kind-specific icon and the host-supplied click handler routes
 * per kind so folder ancestors don't get opened as sheets. The current
 * page is rendered as a trailing non-clickable segment (Notion-style).
 */
export function SheetBreadcrumb({ ancestors, current, onSegmentClick }: Props) {
  if (ancestors.length === 0 && !current) return null

  const currentKind = current ? kindOf(current) : null
  const CurrentIcon = currentKind ? ICON_BY_KIND[currentKind] : null
  const currentLabel = current?.label?.markdown?.trim() || UNTITLED_LABEL

  return (
    <>
      {/* Mobile: a single dropdown trigger that lists every ancestor +
          the current page (greyed out). Inline breadcrumb segments wrap
          awkwardly on narrow screens. */}
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Show ancestors"
            className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground/80 transition-colors hover:text-foreground"
          >
            <DotsThreeIcon className="size-4 shrink-0" weight="bold" />
            <span className="truncate max-w-[200px]">
              {ancestors.length > 0
                ? `${ancestors.length} ${ancestors.length === 1 ? "level" : "levels"} up`
                : currentLabel}
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            {ancestors.map((note) => {
              const kind = kindOf(note)
              const Icon = ICON_BY_KIND[kind]
              const fullLabel = note.label?.markdown?.trim() || UNTITLED_LABEL
              return (
                <DropdownMenuItem
                  key={note.id}
                  onClick={() => onSegmentClick(note, kind)}
                  className="gap-2"
                >
                  {Icon && <Icon className="size-4 shrink-0 opacity-70" strokeWidth={2} />}
                  <span className="truncate">{trimText(fullLabel, 40)}</span>
                </DropdownMenuItem>
              )
            })}
            {current && (
              <DropdownMenuItem
                disabled
                className="gap-2 opacity-100 text-foreground font-medium"
              >
                {CurrentIcon && <CurrentIcon className="size-4 shrink-0 opacity-70" strokeWidth={2} />}
                <span className="truncate">{trimText(currentLabel, 40)}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desktop: inline breadcrumb segments. */}
      <nav
        className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground/80"
        aria-label="Breadcrumb"
      >
        {ancestors.map((note) => {
          const kind = kindOf(note)
          const Icon = ICON_BY_KIND[kind]
          const fullLabel = note.label?.markdown?.trim() || UNTITLED_LABEL
          return (
            <Fragment key={note.id}>
              <button
                type="button"
                onClick={() => onSegmentClick(note, kind)}
                title={fullLabel}
                className="flex items-center gap-1 truncate max-w-[120px] rounded transition-colors hover:text-foreground"
              >
                {Icon && <Icon className="size-3.5 shrink-0 opacity-70" strokeWidth={2} />}
                <span className="truncate">{trimText(fullLabel, 22)}</span>
              </button>
              <CaretRightIcon className="size-3 shrink-0 opacity-50" />
            </Fragment>
          )
        })}
        {current && (
          <span
            className="flex items-center gap-1 truncate max-w-[160px] text-foreground"
            title={currentLabel}
          >
            {CurrentIcon && <CurrentIcon className="size-3.5 shrink-0 opacity-70" strokeWidth={2} />}
            <span className="truncate">{trimText(currentLabel, 28)}</span>
          </span>
        )}
      </nav>
    </>
  )
}
