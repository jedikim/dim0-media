import { useState, type MouseEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import { cn } from "@/lib/utils"
import {
  ChevronRightIcon,
  FolderIcon,
  NotepadIcon,
  CodeFileIcon,
  StockWidgetIcon,
  type AppIconComponent,
} from "@/components/icons"
import { IconPropertyView } from "@/components/icons/icon-property-view"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useBoardContents, type BoardContentItem, type BoardContentKind } from "@/features/board/api/list-board-contents"
import { nodeSurfacePath } from "@/features/board/utils/node-surface-url"
import { trimText } from "@/lib/common"
import { UNTITLED_LABEL } from "@/features/board/const"


const MAX_VISUAL_DEPTH = 5
const INDENT_PX_PER_LEVEL = 12
const BASE_PADDING_PX = 8


const ICON_BY_KIND: Record<BoardContentKind, AppIconComponent> = {
  folder: FolderIcon,
  sheet: NotepadIcon,
  "code-sandbox": CodeFileIcon,
  widget: StockWidgetIcon,
}


type BoardTreeNodeProps = {
  boardId: string
  item: BoardContentItem
  depth: number
  /**
   * Closest folder ancestor of this row in the sidebar lineage. Threaded
   * down so when the user clicks a leaf (sheet/code/widget) we can scope
   * the canvas to the matching folder — otherwise the URL keeps an
   * unrelated `root_id` and the background canvas drifts away from the
   * note the panel just opened.
   */
  parentFolderId?: string
  /**
   * Local mode: children come from `localContents` (filtered by `parentId`) rather
   * than the backend, and navigation targets the `/local/$boardId/*` routes. Local
   * persistence has no per-level query, so the whole tree is loaded once by the
   * board row and threaded down here.
   */
  local?: boolean
  /** Full flat surface-node list for a local board (all levels). Ignored unless `local`. */
  localContents?: BoardContentItem[]
}


/**
 * Recursive sidebar row for a board's surface node (sheet/folder/code-sandbox/widget).
 * Folders and sheets are both expandable — sheets reveal sub-pages
 * (`parent_id` of another note) on disclosure; folders reveal their
 * canvas children. The kind icon morphs to a chevron on row-hover so
 * the user can expand/collapse without leaving the current view.
 */
export function BoardTreeNode({
  boardId,
  item,
  depth,
  parentFolderId,
  local = false,
  localContents,
}: BoardTreeNodeProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)

  const isFolder = item.kind === "folder"
  const isSheet = item.kind === "sheet"
  const isExpandable = isFolder || isSheet
  const KindIcon = ICON_BY_KIND[item.kind]
  const customIcon = item.iconData ?? null

  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH)
  const paddingLeft = BASE_PADDING_PX + visualDepth * INDENT_PX_PER_LEVEL

  const fullLabel = item.label?.trim() || UNTITLED_LABEL
  const displayLabel = trimText(fullLabel, 40)

  // Synced: fetch this level from the backend on expand. Local: the whole board's
  // surface list is already in memory (threaded via `localContents`), so filter
  // children by parentId — the hook is still called (disabled) to keep hook order.
  const syncedQuery = useBoardContents(boardId, item.id, {
    enabled: !local && isExpandable && expanded,
  })
  const children: BoardContentItem[] = local
    ? (localContents ?? []).filter((c) => (c.parentId ?? null) === item.id)
    : (syncedQuery.data ?? [])
  const isLoading = local ? false : syncedQuery.isLoading

  const handleNavigate = () => {
    // Keep `current_chat_id` etc. but realign `root_id` to the closest
    // folder ancestor in the sidebar lineage so the background canvas
    // matches the note the panel is opening. `parentFolderId` undefined
    // means the leaf lives at the board root — drop `root_id` entirely.
    const scopeToParentFolder = (prev: Record<string, unknown>) => {
      if (parentFolderId) return { ...prev, root_id: parentFolderId }
      const rest = { ...prev }
      delete rest.root_id
      return rest
    }
    // Surface leaves open the panel route (kind→URL mapping owned by
    // nodeSurfacePath); only the board param name (`id` vs `boardId`) differs.
    // Conditional `params` can't be expressed in TanStack's typed navigate,
    // hence the cast.
    if (item.kind === "sheet" || item.kind === "code-sandbox" || item.kind === "widget") {
      navigate({
        to: nodeSurfacePath(item.kind, local),
        params: local ? { boardId, noteId: item.id } : { id: boardId, noteId: item.id },
        search: scopeToParentFolder,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      return
    }
    // Folder (or fallback): stay on the board route, scope the canvas via root_id.
    navigate({
      to: local ? "/local/$boardId" : "/boards/$id",
      params: local ? { boardId } : { id: boardId },
      search: (prev: Record<string, unknown>) =>
        item.kind === "folder" ? { ...prev, root_id: item.id } : prev,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  }

  const handleToggle = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setExpanded((v) => !v)
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        className="group/tree-row flex items-center gap-2 rounded-md text-xs text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer min-h-7 pr-1.5"
        style={{ paddingLeft }}
        onClick={handleNavigate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            handleNavigate()
          }
        }}
      >
        {isExpandable ? (
          <button
            type="button"
            onClick={handleToggle}
            className="size-5 shrink-0 grid place-items-center rounded hover:bg-sidebar-accent-foreground/10"
            aria-label={expanded ? `Collapse ${item.kind}` : `Expand ${item.kind}`}
          >
            {customIcon ? (
              <span
                className={cn(
                  "transition-opacity",
                  "group-hover/tree-row:hidden",
                  expanded && "hidden",
                )}
              >
                <IconPropertyView icon={customIcon} size={16} />
              </span>
            ) : (
              <KindIcon
                className={cn(
                  "size-4 text-muted-foreground transition-opacity",
                  "group-hover/tree-row:hidden",
                  expanded && "hidden",
                )}
                strokeWidth={2}
              />
            )}
            <ChevronRightIcon
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                expanded
                  ? "block rotate-90"
                  : "hidden group-hover/tree-row:block",
              )}
              strokeWidth={2}
            />
          </button>
        ) : (
          <span className="size-5 shrink-0 grid place-items-center">
            {customIcon ? (
              <IconPropertyView icon={customIcon} size={16} />
            ) : (
              <KindIcon className="size-4 text-muted-foreground" strokeWidth={2} />
            )}
          </span>
        )}

        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <span className="flex-1 min-w-0 truncate">{displayLabel}</span>
          </TooltipTrigger>
          <TooltipContent side="right" align="center" className="max-w-64">
            <span className="text-xs">{fullLabel}</span>
          </TooltipContent>
        </Tooltip>
      </div>

      {isExpandable && expanded && (
        <ul className="flex flex-col">
          {isLoading && children.length === 0 ? (
            <li
              className="py-1 text-[11px] italic text-muted-foreground"
              style={{ paddingLeft: paddingLeft + INDENT_PX_PER_LEVEL + 20 }}
            >
              Loading…
            </li>
          ) : children.length === 0 ? (
            <li
              className="py-1 text-[11px] italic text-muted-foreground"
              style={{ paddingLeft: paddingLeft + INDENT_PX_PER_LEVEL + 20 }}
            >
              {isSheet ? "No sub-pages" : "Empty"}
            </li>
          ) : (
            children.map((child) => (
              <BoardTreeNode
                key={child.id}
                boardId={boardId}
                item={child}
                depth={depth + 1}
                // Folders bound a new canvas scope; sheets/sub-pages
                // inherit the closest folder ancestor unchanged.
                parentFolderId={isFolder ? item.id : parentFolderId}
                local={local}
                localContents={localContents}
              />
            ))
          )}
        </ul>
      )}
    </li>
  )
}
