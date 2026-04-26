import { useState, type MouseEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import { cn } from "@/lib/utils"
import {
  ChevronRightIcon,
  FolderIcon,
  DocumentIcon,
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
  sheet: DocumentIcon,
  "code-sandbox": CodeFileIcon,
  widget: StockWidgetIcon,
}


type BoardTreeNodeProps = {
  boardId: string
  item: BoardContentItem
  depth: number
}


/**
 * Recursive sidebar row for a board's surface node (sheet/folder/code-sandbox/widget).
 * Folders show their kind icon by default and morph to a chevron on row-hover so
 * the user can expand/collapse without leaving the current view; clicking the
 * label navigates (into the folder, sheet, or board).
 */
export function BoardTreeNode({ boardId, item, depth }: BoardTreeNodeProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)

  const isFolder = item.kind === "folder"
  const KindIcon = ICON_BY_KIND[item.kind]

  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH)
  const paddingLeft = BASE_PADDING_PX + visualDepth * INDENT_PX_PER_LEVEL

  const fullLabel = item.label?.trim() || UNTITLED_LABEL
  const displayLabel = trimText(fullLabel, 40)

  const { data: children = [], isLoading } = useBoardContents(boardId, item.id, {
    enabled: isFolder && expanded,
  })

  const handleNavigate = () => {
    if (item.kind === "sheet") {
      navigate({
        to: "/boards/$id/sheets/$noteId",
        params: { id: boardId, noteId: item.id },
      })
      return
    }
    if (item.kind === "folder") {
      navigate({
        to: "/boards/$id",
        params: { id: boardId },
        search: { root_id: item.id },
      })
      return
    }
    navigate({ to: "/boards/$id", params: { id: boardId } })
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
        {isFolder ? (
          <button
            type="button"
            onClick={handleToggle}
            className="size-5 shrink-0 grid place-items-center rounded hover:bg-sidebar-accent-foreground/10"
            aria-label={expanded ? "Collapse folder" : "Expand folder"}
          >
            <FolderIcon
              className="size-4 text-muted-foreground group-hover/tree-row:hidden"
              strokeWidth={2}
            />
            <ChevronRightIcon
              className={cn(
                "size-4 text-muted-foreground hidden group-hover/tree-row:block transition-transform",
                expanded && "rotate-90",
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

      {isFolder && expanded && (
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
              Empty
            </li>
          ) : (
            children.map((child) => (
              <BoardTreeNode
                key={child.id}
                boardId={boardId}
                item={child}
                depth={depth + 1}
              />
            ))
          )}
        </ul>
      )}
    </li>
  )
}
