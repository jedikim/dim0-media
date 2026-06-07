import { Fragment } from "react"
import { CaretRightIcon, DotsThreeIcon } from "@phosphor-icons/react"
import { useNode } from "@canvas-harness/react"
import type { NodeId } from "@canvas-harness/core"
import {
  FolderIcon,
  NotepadIcon,
  CodeFileIcon,
  StockWidgetIcon,
  type AppIconComponent,
} from "@/components/icons"
import { IconPropertyView } from "@/components/icons/icon-property-view"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { trimText } from "@/lib/common"
import type { Note } from "../../types/note"
import {
  resolveCrumb,
  type CrumbNodeData,
  type ResolvedCrumb,
} from "./resolve-crumb"


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


/**
 * Reactive wrapper around {@link resolveCrumb}: subscribes to the note's
 * live canvas-store record via `useNode` so renames / icon changes re-render
 * the crumb with no refetch.
 */
function useLiveCrumb(note: Note | undefined): ResolvedCrumb {
  const live = useNode((note?.id ?? "") as NodeId)
  return resolveCrumb(live?.data as CrumbNodeData | undefined, note)
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


/** Desktop inline ancestor segment — clickable, live title from the store. */
function DesktopAncestor({
  note,
  onSegmentClick,
}: {
  note: Note
  onSegmentClick: Props["onSegmentClick"]
}) {
  const kind = kindOf(note)
  const Icon = ICON_BY_KIND[kind]
  const { label, icon } = useLiveCrumb(note)
  return (
    <Fragment>
      <button
        type="button"
        onClick={() => onSegmentClick(note, kind)}
        title={label}
        className="flex items-center gap-1 truncate max-w-[120px] rounded transition-colors hover:text-foreground"
      >
        {icon ? (
          <IconPropertyView icon={icon} size={14} className="shrink-0 opacity-70" />
        ) : (
          Icon && <Icon className="size-3.5 shrink-0 opacity-70" strokeWidth={2} />
        )}
        <span className="truncate">{trimText(label, 22)}</span>
      </button>
      <CaretRightIcon className="size-3 shrink-0 opacity-50" />
    </Fragment>
  )
}


/** Mobile dropdown ancestor item — clickable, live title from the store. */
function MobileAncestor({
  note,
  onSegmentClick,
}: {
  note: Note
  onSegmentClick: Props["onSegmentClick"]
}) {
  const kind = kindOf(note)
  const Icon = ICON_BY_KIND[kind]
  const { label, icon } = useLiveCrumb(note)
  return (
    <DropdownMenuItem onClick={() => onSegmentClick(note, kind)} className="gap-2">
      {icon ? (
        <IconPropertyView icon={icon} size={16} className="shrink-0 opacity-70" />
      ) : (
        Icon && <Icon className="size-4 shrink-0 opacity-70" strokeWidth={2} />
      )}
      <span className="truncate">{trimText(label, 40)}</span>
    </DropdownMenuItem>
  )
}


/**
 * Breadcrumb shown above the current sheet's title. Each ancestor segment
 * carries a kind-specific icon and the host-supplied click handler routes
 * per kind so folder ancestors don't get opened as sheets. The current
 * page is rendered as a trailing non-clickable segment (Notion-style).
 * All titles are read live from the canvas store so renames show at once.
 */
export function SheetBreadcrumb({ ancestors, current, onSegmentClick }: Props) {
  const currentKind = current ? kindOf(current) : null
  const CurrentIcon = currentKind ? ICON_BY_KIND[currentKind] : null
  const { label: currentLabel, icon: currentIcon } = useLiveCrumb(current)

  if (ancestors.length === 0 && !current) return null

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
            {ancestors.map((note) => (
              <MobileAncestor key={note.id} note={note} onSegmentClick={onSegmentClick} />
            ))}
            {current && (
              <DropdownMenuItem
                disabled
                className="gap-2 opacity-100 text-foreground font-medium"
              >
                {currentIcon ? (
                  <IconPropertyView icon={currentIcon} size={16} className="shrink-0 opacity-70" />
                ) : (
                  CurrentIcon && <CurrentIcon className="size-4 shrink-0 opacity-70" strokeWidth={2} />
                )}
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
        {ancestors.map((note) => (
          <DesktopAncestor key={note.id} note={note} onSegmentClick={onSegmentClick} />
        ))}
        {current && (
          <span
            className="flex items-center gap-1 truncate max-w-[160px] text-foreground"
            title={currentLabel}
          >
            {currentIcon ? (
              <IconPropertyView icon={currentIcon} size={14} className="shrink-0 opacity-70" />
            ) : (
              CurrentIcon && <CurrentIcon className="size-3.5 shrink-0 opacity-70" strokeWidth={2} />
            )}
            <span className="truncate">{trimText(currentLabel, 28)}</span>
          </span>
        )}
      </nav>
    </>
  )
}
