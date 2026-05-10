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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useBoardContents, type BoardContentItem, type BoardContentKind } from "@/features/board/api/list-board-contents"
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
}


/**
 * Recursive sidebar row for a board's surface node (sheet/folder/code-sandbox/widget).
 * Folders and sheets are both expandable — sheets reveal sub-pages
 * (`parent_id` of another note) on disclosure; folders reveal their
 * canvas children. The kind icon morphs to a chevron on row-hover so
 * the user can expand/collapse without leaving the current view.
 */
export function BoardTreeNode({ boardId, item, depth, parentFolderId }: BoardTreeNodeProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)

  const isFolder = item.kind === "folder"
  const isSheet = item.kind === "sheet"
  const isExpandable = isFolder || isSheet
  const KindIcon = ICON_BY_KIND[item.kind]

  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH)
  const paddingLeft = BASE_PADDING_PX + visualDepth * INDENT_PX_PER_LEVEL

  const fullLabel = item.label?.trim() || UNTITLED_LABEL
  const displayLabel = trimText(fullLabel, 40)

  const { data: children = [], isLoading } = useBoardContents(boardId, item.id, {
    enabled: isExpandable && expanded,
  })

  const handleNavigate = () => {
    // Keep `current_chat_id` etc. but realign `root_id` to the closest
    // folder ancestor in the sidebar lineage so the background canvas
    // matches the note the panel is opening. `parentFolderId` undefined
    // means the leaf lives at the board root — drop `root_id` entirely.
    const scopeToParentFolder = (prev: Record<string, unknown>) => {
      const { root_id: _drop, ...rest } = prev
      return parentFolderId ? { ...rest, root_id: parentFolderId } : rest
    }
    if (item.kind === "sheet") {
      navigate({
        to: "/boards/$id/sheets/$noteId",
        params: { id: boardId, noteId: item.id },
        search: scopeToParentFolder,
      })
      return
    }
    if (item.kind === "code-sandbox") {
      navigate({
        to: "/boards/$id/code-sandbox/$noteId",
        params: { id: boardId, noteId: item.id },
        search: scopeToParentFolder,
      })
      return
    }
    if (item.kind === "widget") {
      navigate({
        to: "/boards/$id/widgets/$noteId",
        params: { id: boardId, noteId: item.id },
        search: scopeToParentFolder,
      })
      return
    }
    if (item.kind === "folder") {
      navigate({
        to: "/boards/$id",
        params: { id: boardId },
        search: (prev: Record<string, unknown>) => ({ ...prev, root_id: item.id }),
      })
      return
    }
    navigate({
      to: "/boards/$id",
      params: { id: boardId },
      search: (prev: Record<string, unknown>) => prev,
    })
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
            <KindIcon
              className={cn(
                "size-4 text-muted-foreground transition-opacity",
                "group-hover/tree-row:hidden",
                expanded && "hidden",
              )}
              strokeWidth={2}
            />
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
            <KindIcon className="size-4 text-muted-foreground" strokeWidth={2} />
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
              />
            ))
          )}
        </ul>
      )}
    </li>
  )
}
