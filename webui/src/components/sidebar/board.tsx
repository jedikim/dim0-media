import { useCreateBoard } from "@/features/board/api/create-board"
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar"
import { useDeleteBoard } from "@/features/board/api/delete-board"
import { trimText } from "@/lib/common"
import { cn } from "@/lib/utils"
import { UNTITLED_LABEL } from "@/features/board/const"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu"
import { Collapsible, CollapsibleContent } from "../ui/collapsible"
import { BoardContextIcon, ChatHistoryIcon, ChevronRightIcon, CloudArrowUpIcon, DashboardAddIcon, DeleteIcon, EditIcon } from "@/components/icons"
import { ChatsDialog } from "./chats-dialog"
import { ConfirmDeleteBoardAlert } from "./confirm-delete-board"
import { BoardTreeNode } from "./board-tree-node"
import { useBoardContents } from "@/features/board/api/list-board-contents"
import { useLocalBoardContents } from "@/features/board/api/list-local-board-contents"
import { useState, type MouseEvent } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { useAppStore } from "@/store"
import { FREE_PLAN_BOARD_LIMIT_TOOLTIP, isBoardCreationLimited } from "@/features/board/lib/board-limit"
import { useListBoards } from "@/features/board/api/list-boards"

/**
 * Dashboard menu item component
 */
export function DashboardMenuItem() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const isActive = pathname === `/boards`

  const handleClick = () => {
    navigate({ to: '/boards' })
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={handleClick}
        className="text-xs font-medium truncate"
        isActive={isActive}
      >
        <DashboardAddIcon className="shrink-0 size-4 text-sidebar-icon-2" weight={isActive ? 'fill' : undefined} strokeWidth={2} />
        <span>Dashboard</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * New board item component
 */
export function NewBoardItem() {
  const { createBoardAsync } = useCreateBoard()
  const userId = useAppStore(s => s.userId)
  const { data: boards = [] } = useListBoards(userId)
  const userPlan = useAppStore(s => s.userPlan)
  // Subscribe so the gate re-renders when billingActive is hydrated at boot.
  const billingActive = useAppStore(s => s.billingActive)
  const navigate = useNavigate()
  const boardCreationLimited = billingActive && isBoardCreationLimited(userPlan, boards.length)

  const handleClick = async () => {
    if (boardCreationLimited) return

    const newId = await createBoardAsync()
    // Go to /boards/:id (no page refresh)
    navigate({ to: '/boards/$id', params: { id: newId } })
  }

  if (boardCreationLimited) {
    return (
      <SidebarMenuItem>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <SidebarMenuButton
                className="text-xs text-secondary-foreground/60 font-medium transition-all cursor-not-allowed opacity-60"
                disabled
                onClick={handleClick}
              >
                <EditIcon className="text-xs shrink-0 text-sidebar-icon-1/60" strokeWidth={2} />
                <span>New Board</span>
              </SidebarMenuButton>
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" align="center" className="max-w-64">
            <p className="text-xs">{FREE_PLAN_BOARD_LIMIT_TOOLTIP}</p>
          </TooltipContent>
        </Tooltip>
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton className="text-xs text-secondary-foreground font-medium transition-all" onClick={handleClick}>
        <EditIcon className="text-xs shrink-0 text-sidebar-icon-1" strokeWidth={2} />
        <span>New Board</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}


/**
 * "New board" tile — creates a LOCAL board (local-first default). Synced boards
 * are never created directly; they come from promoting a local board. `onClick`
 * is wired by the sidebar to the local registry + navigation.
 */
export function NewLocalBoardItem({ onClick }: { onClick: () => void }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="text-xs text-secondary-foreground font-medium transition-all"
        onClick={onClick}
      >
        <EditIcon className="text-xs shrink-0 text-sidebar-icon-1" strokeWidth={2} />
        <span>New board</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}


/**
 * A local-only board row in the sidebar's LOCAL group. Presentational — the
 * sidebar owns the local registry + enable-sync hooks and passes callbacks.
 * Routes to `/local/$boardId`; context menu offers Enable sync (one-way promote)
 * and Delete. Expands to its surface-node hierarchy (sheets/folders/…) read from
 * the on-device store via `useLocalBoardContents` — the local analog of the
 * synced BoardItem's backend-served tree.
 */
export function LocalBoardItem({
  boardId,
  label,
  isActive,
  syncing = false,
  onOpen,
  onEnableSync,
  onDelete,
}: {
  boardId: string
  label?: string
  isActive: boolean
  syncing?: boolean
  onOpen: () => void
  onEnableSync: () => void
  onDelete: () => void
}) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const boardLabel = label || UNTITLED_LABEL
  const boardDisplayLabel = trimText(boardLabel, 20)

  // Whole-board surface list, loaded once on expand; each level filters in memory.
  const { data: allContents = [], isLoading } = useLocalBoardContents(boardId, {
    enabled: isOpen,
  })
  const rootContents = allContents.filter((c) => (c.parentId ?? null) === null)

  const handleToggle = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsOpen((v) => !v)
  }

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <ContextMenuTrigger asChild>
                <SidebarMenuButton
                  onClick={onOpen}
                  className="group/board-row text-xs font-medium truncate"
                  isActive={isActive}
                >
                  <span
                    role="button"
                    aria-label={isOpen ? "Collapse board" : "Expand board"}
                    onClick={handleToggle}
                    className="size-4 shrink-0 grid place-items-center cursor-pointer"
                  >
                    <BoardContextIcon
                      className="size-4 group-hover/board-row:hidden"
                      weight={isActive ? "fill" : undefined}
                    />
                    <ChevronRightIcon
                      className={cn(
                        "size-4 hidden group-hover/board-row:block transition-transform",
                        isOpen && "rotate-90",
                      )}
                      strokeWidth={2}
                    />
                  </span>
                  <span className="truncate">{boardDisplayLabel}</span>
                </SidebarMenuButton>
              </ContextMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" className="max-w-64">
              <p className="text-xs">{boardLabel}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">On this device</p>
            </TooltipContent>
          </Tooltip>

          <ContextMenuContent className="w-44">
            <ContextMenuItem
              onSelect={() => onEnableSync()}
              disabled={syncing}
              className="text-xs flex flex-row items-center"
            >
              <CloudArrowUpIcon className="mr-2 size-4" strokeWidth={2} />
              <span>{syncing ? "Enabling sync…" : "Enable sync"}</span>
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                window.setTimeout(() => setIsConfirmOpen(true), 0)
              }
              variant="destructive"
              className="text-xs flex flex-row items-center"
            >
              <DeleteIcon className="mr-2 size-4" strokeWidth={2} />
              <span>Delete board</span>
            </ContextMenuItem>
          </ContextMenuContent>

          <CollapsibleContent>
            {isLoading && rootContents.length === 0 ? (
              <p className="pl-7 py-1 text-[11px] italic text-muted-foreground">Loading…</p>
            ) : rootContents.length === 0 ? (
              <p className="pl-7 py-1 text-[11px] italic text-muted-foreground">Empty</p>
            ) : (
              <ul className="flex flex-col">
                {rootContents.map((item) => (
                  <BoardTreeNode
                    key={item.id}
                    boardId={boardId}
                    item={item}
                    depth={1}
                    local
                    localContents={allContents}
                  />
                ))}
              </ul>
            )}
          </CollapsibleContent>
        </Collapsible>
      </ContextMenu>

      {/* Visible one-click promote-to-sync (also in the context menu above).
          Local rows have no chat action, so this is the single trailing icon —
          the menu-button's built-in pr-8 reserves its space, keeping the title
          truncation correct. */}
      {/* Not `disabled` while syncing: a disabled button fires no hover/title, so
          the "Enabling sync…" tooltip would never show. Re-entry is instead guarded
          at the source (useEnableSync), so a click mid-sync is a safe no-op. */}
      <SidebarMenuAction
        showOnHover
        onClick={(e) => {
          e.stopPropagation()
          onEnableSync()
        }}
        title={syncing ? "Enabling sync…" : "Enable sync — back up + share this board"}
        aria-label="Enable sync"
        className={cn(
          "text-muted-foreground/50 hover:text-secondary-foreground",
          syncing && "opacity-50",
        )}
      >
        <CloudArrowUpIcon className={cn("size-4", syncing && "animate-pulse")} strokeWidth={2} />
      </SidebarMenuAction>

      <ConfirmDeleteBoardAlert
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        onConfirm={() => {
          onDelete()
          setIsConfirmOpen(false)
        }}
      />
    </SidebarMenuItem>
  )
}


/** Existing board item.
 *
 * `sharedByEmail` is present only for boards the current user accessed
 * via share-link (sidebar "Shared with me" section); when set, we
 * surface "shared by …" in the tooltip and skip the Delete context-
 * menu entry — non-owners can't delete the board.
 */
export function BoardItem({
  boardId,
  label,
  sharedByEmail,
}: {
  boardId: string
  label?: string
  sharedByEmail?: string
}) {
  const { deleteBoard } = useDeleteBoard()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })

  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [chatsDialogOpen, setChatsDialogOpen] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const isActive =
    pathname === `/boards/${boardId}` ||
    pathname.startsWith(`/boards/${boardId}/`)

  const { data: rootContents = [], isLoading: isLoadingContents } = useBoardContents(
    boardId,
    undefined,
    { enabled: isOpen },
  )

  const handleClick = () => {
    navigate({ to: "/boards/$id", params: { id: boardId } })
  }

  const handleToggle = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsOpen((v) => !v)
  }

  const handleDelete = () => {
    deleteBoard({ boardId })
    if (isActive) {
      navigate({ to: "/boards" })
    }
  }

  // called when user clicks "Delete Board" in the context menu
  const handleRequestDelete = () => {
    // let the ContextMenu close first (and release its pointer-events stuff),
    // then open the AlertDialog on the next tick
    window.setTimeout(() => {
      setIsConfirmOpen(true)
    }, 0)
  }

  const boardLabel = label || UNTITLED_LABEL
  const boardDisplayLabel = trimText(boardLabel, 20)

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <ContextMenuTrigger asChild>
                <SidebarMenuButton
                  onClick={handleClick}
                  className="group/board-row text-xs font-medium truncate"
                  isActive={isActive}
                >
                  <span
                    role="button"
                    aria-label={isOpen ? "Collapse board" : "Expand board"}
                    onClick={handleToggle}
                    className="size-4 shrink-0 grid place-items-center cursor-pointer"
                  >
                    <BoardContextIcon
                      className="size-4 group-hover/board-row:hidden"
                      weight={isActive ? 'fill' : undefined}
                    />
                    <ChevronRightIcon
                      className={cn(
                        "size-4 hidden group-hover/board-row:block transition-transform",
                        isOpen && "rotate-90",
                      )}
                      strokeWidth={2}
                    />
                  </span>
                  <span className="truncate">{boardDisplayLabel}</span>
                </SidebarMenuButton>
              </ContextMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" className="max-w-64">
              <p className="text-xs">{boardLabel}</p>
              {sharedByEmail && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  shared by {sharedByEmail}
                </p>
              )}
            </TooltipContent>
          </Tooltip>

          {!sharedByEmail && (
            <ContextMenuContent className="w-44">
              <ContextMenuItem
                onSelect={() => handleRequestDelete()}
                variant="destructive"
                className="text-xs flex flex-row items-center"
              >
                <DeleteIcon className="mr-2 size-4" strokeWidth={2} />
                <span>Delete Board</span>
              </ContextMenuItem>
            </ContextMenuContent>
          )}

          <CollapsibleContent>
            {isLoadingContents && rootContents.length === 0 ? (
              <p className="pl-7 py-1 text-[11px] italic text-muted-foreground">Loading…</p>
            ) : rootContents.length === 0 ? (
              <p className="pl-7 py-1 text-[11px] italic text-muted-foreground">Empty</p>
            ) : (
              <ul className="flex flex-col">
                {rootContents.map((item) => (
                  <BoardTreeNode key={item.id} boardId={boardId} item={item} depth={1} />
                ))}
              </ul>
            )}
          </CollapsibleContent>
        </Collapsible>
      </ContextMenu>

      <SidebarMenuAction
        className="right-1.5 text-muted-foreground/40 hover:text-muted-foreground hover:bg-transparent"
        onClick={() => setChatsDialogOpen(true)}
        title="View chats in this board"
        aria-label="View chats in this board"
      >
        <ChatHistoryIcon className="size-4" strokeWidth={2} />
      </SidebarMenuAction>

      <ChatsDialog
        open={chatsDialogOpen}
        onOpenChange={setChatsDialogOpen}
        boardId={boardId}
        title={`Chats — ${boardDisplayLabel}`}
      />

      <ConfirmDeleteBoardAlert
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        onConfirm={() => {
          handleDelete()
          setIsConfirmOpen(false)
        }}
      />
    </SidebarMenuItem>
  )
}
