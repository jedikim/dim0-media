import { useCreateBoard } from "@/features/board/api/create-board"
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from "../ui/sidebar"
import { useDeleteBoard } from "@/features/board/api/delete-board"
import { trimText } from "@/lib/common"
import { UNTITLED_LABEL } from "@/features/board/const"
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu"
import { BoardContextIcon, DashboardAddIcon, DeleteIcon, EditIcon, MinusIcon, PlusIcon } from "@/components/icons"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible"
import { ChatMenuItem, NewChatItem } from "./chat"
import { ConfirmDeleteBoardAlert } from "./confirm-delete-board"
import { useEffect, useState } from "react"
import { useListChats } from "@/features/agent/api/list-chats"
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
  const navigate = useNavigate()
  const boardCreationLimited = isBoardCreationLimited(userPlan, boards.length)

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


/** Existing board item */
export function BoardItem({ boardId, label }: { boardId: string, label?: string }) {
  const { deleteBoard } = useDeleteBoard()
  const userId = useAppStore(s => s.userId)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const chatParams = useParams({ from: "/chats/$id", shouldThrow: false })
  const boardSearch = useSearch({
    from: "/boards/$id",
    select: (s: { current_chat_id?: string }) => s.current_chat_id,
    shouldThrow: false
  })

  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const { data: chats = [] } = useListChats({ graphUid: boardId, userId })
  const activeChatId = chatParams?.id ?? boardSearch

  const isActive =
    pathname === `/boards/${boardId}` ||
    pathname.startsWith(`/boards/${boardId}/`)
  const hasActiveBoardChat = Boolean(activeChatId && chats.some(chat => chat.uid === activeChatId))

  useEffect(() => {
    if (!hasActiveBoardChat) return
    setIsOpen(true)
  }, [hasActiveBoardChat])

  const handleClick = () => {
    navigate({ to: "/boards/$id", params: { id: boardId } })
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
        <Collapsible
          open={isOpen}
          onOpenChange={setIsOpen}
          className="group/collapsible w-full"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ContextMenuTrigger asChild>
                <SidebarMenuButton
                  onClick={handleClick}
                className="text-xs font-medium truncate"
                isActive={isActive}
              >
                  <BoardContextIcon className="shrink-0 size-4" weight={isActive ? 'fill' : undefined} />
                  <span>{boardDisplayLabel}</span>
                </SidebarMenuButton>
              </ContextMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" align="center" className="max-w-64">
              <p className="text-xs">{boardLabel}</p>
            </TooltipContent>
          </Tooltip>

          <ContextMenuContent className="w-44">
            <ContextMenuItem
              // let Radix close the menu naturally
              onSelect={() => handleRequestDelete()}
              variant="destructive"
              className="text-xs flex flex-row items-center"
            >
              <DeleteIcon className="mr-2 size-4" strokeWidth={2} />
              <span>Delete Board</span>
            </ContextMenuItem>
          </ContextMenuContent>

          <CollapsibleTrigger asChild>
            <SidebarMenuAction className="right-1.5">
              <PlusIcon className="group-data-[state=open]/collapsible:hidden" strokeWidth={2} />
              <MinusIcon className="group-data-[state=closed]/collapsible:hidden" strokeWidth={2} />
            </SidebarMenuAction>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <SidebarMenuSub>
              {
                chats?.map(chat => (
                  <ChatMenuItem key={chat.uid} chatId={chat.uid} label={chat.label} />
                )) || []
              }
              <NewChatItem initialBoardId={boardId} isSubMenuItem />
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </ContextMenu>

      {/* Alert lives OUTSIDE the ContextMenu, controlled by state */}
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
