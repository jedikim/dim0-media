import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel,
  ContextMenuSeparator, ContextMenuTrigger
} from "@/components/ui/context-menu"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { useConvertToMindMap } from "@/features/board/api/convert-to-mindmap"
import { useCreateBoard } from "@/features/board/api/create-board"
import { useListBoards } from "@/features/board/api/list-boards"
import { UNTITLED_LABEL } from "@/features/board/const"
import { useBoardAppStore } from "@/features/board/harness/store/board-app-store"
import {
  CancelStatusIcon,
  CheckCircleStatusIcon,
  CircleNotchIcon,
  NotebookIcon,
  SchemaMapIcon,
  TreeMapIcon,
  type AppIconComponent,
} from "@/components/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNavigate } from "@tanstack/react-router"
import clsx from "clsx"
import { useState } from "react"
import { toast } from "sonner"
import { useAppStore } from "@/store"


// Spinner icon for loading state
const LoadingIcon = () => (
  <CircleNotchIcon
    className="size-4 animate-spin [animation-duration:750ms]"
    strokeWidth={2}
  />
)

const SuccessIcon = () => (
  <CheckCircleStatusIcon
    className="text-foreground size-4"
    strokeWidth={2}
  />
)

const ErrorIcon = () => (
  <CancelStatusIcon
    className="text-destructive size-4"
    strokeWidth={2}
  />
)


export interface SaveAsNoteProps {
  message: string
  type: "notify" | "mapify" | "schemify"
  saveAsIs?: boolean
  boardId?: string
  useAnchors?: boolean
  compact?: boolean
}


// Button that generates a mind map from the given message.
export const SaveAsNote = ({
  message,
  type,
  saveAsIs = false,
  boardId,
  useAnchors = false,
  compact = false,
}: SaveAsNoteProps) => {
  const [processing, setProcessing] = useState<boolean>(false)
  const userId = useAppStore(s => s.userId)
  const rootId = useBoardAppStore(state => state.rootId) ?? undefined

  const { convertToMindMapAsync } = useConvertToMindMap()
  const { data: boardList } = useListBoards(userId)
  const { createBoardAsync } = useCreateBoard()

  const navigate = useNavigate()

  /**
   * Navigate to a board, preserving the current subfolder context when present.
   */
  const goToBoard = (targetBoardId: string) => {
    navigate({
      to: '/boards/$id',
      params: { id: targetBoardId },
      search: rootId
        ? (prev: Record<string, unknown>) => ({ ...prev, root_id: rootId })
        : undefined,
    })
  }

  const ensureMessage = () => {
    if (!message.trim()) {
      toast.error("No message to convert!")
      return false
    }
    return true
  }

  // Launch on an existing board, with loading/success/error toasts
  const launchGeneration = async (boardId: string) => {
    if (!ensureMessage()) return
    if (processing) return

    setProcessing(true)
    const startedAt = Date.now()
    const formatElapsed = () => `${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s`
    const id = toast(`Rewriting… ${formatElapsed()}`, {
      icon: <LoadingIcon />,
      duration: Infinity
    })
    const timer = window.setInterval(() => {
      toast(`Rewriting… ${formatElapsed()}`, {
        id,
        icon: <LoadingIcon />,
        duration: Infinity
      })
    }, 1000)
    try {
      await convertToMindMapAsync({
        boardId,
        answer: message,
        toolType: type,
        saveAsIs,
        useAnchors
      })
      window.clearInterval(timer)
      toast.dismiss(id)
      const finalElapsed = formatElapsed()
      toast.success(`Notes updated. (${finalElapsed})`, {
        icon: <SuccessIcon />,
        duration: 3000,
        action: {
          label: "Go to board",
          onClick: () => {
            goToBoard(boardId)
          }
        }
      })
    } catch (error) {
      console.error("Error converting to mind map:", error)
      window.clearInterval(timer)
      toast.dismiss(id)
      const finalElapsed = formatElapsed()
      toast.error(`Failed to rewrite. (${finalElapsed})`, {
        icon: <ErrorIcon />,
        duration: 4000
      })
    } finally {
      window.clearInterval(timer)
      setProcessing(false)
    }
  }

  // Create a new board, then generate — one toast sequence for the whole flow
  const createAndLaunch = async () => {
    if (!ensureMessage()) return
    if (processing) return

    setProcessing(true)
    const startedAt = Date.now()
    const formatElapsed = () => `${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s`
    const id = toast(
      `Creating board and rewriting… ${formatElapsed()}`,
      {
        icon: <LoadingIcon />,
        duration: Infinity
      }
    )
    const timer = window.setInterval(() => {
      toast(`Creating board and rewriting… ${formatElapsed()}`, {
        id,
        icon: <LoadingIcon />,
        duration: Infinity
      })
    }, 1000)
    try {
      const boardId = await createBoardAsync()
      await convertToMindMapAsync({ boardId, answer: message, toolType: type, saveAsIs, useAnchors })
      window.clearInterval(timer)
      toast.dismiss(id)
      const finalElapsed = formatElapsed()
      toast.success(
        `Notes updated. (${finalElapsed})`,
        {
          icon: <SuccessIcon />,
          duration: 3000,
          action: {
            label: "Go to board",
            onClick: () => {
              goToBoard(boardId)
            }
          }
        }
      )
    } catch (error) {
      console.error("Error creating board or converting to mind map:", error)
      window.clearInterval(timer)
      toast.dismiss(id)
      const finalElapsed = formatElapsed()
      toast.error(
        `Could not create the board or rewrite. (${finalElapsed})`,
        {
          icon: <ErrorIcon />,
          duration: 4000
        })
    } finally {
      window.clearInterval(timer)
      setProcessing(false)
    }
  }

  const label = type === "notify" ? "Notify" : type === "mapify" ? "Mapify" : "Schemify"
  const Icon: AppIconComponent = type === "notify"
    ? NotebookIcon
    : type === "mapify"
      ? TreeMapIcon
      : SchemaMapIcon
  const actionLabel = type === "notify"
    ? "Convert current answer to a sticky note"
    : type === "mapify"
    ? "Convert current answer to a mind map"
    : "Convert current answer to a schema"

  const buttonClass = clsx(
    "transition-all text-muted-foreground hover:text-foreground flex flex-row items-center rounded-md",
    compact ? "justify-center size-8" : "text-xs gap-2 p-1",
    processing && "opacity-75 pointer-events-none"
  )

  const iconCpn = processing ?
    <LoadingIcon /> :
    <Icon className="size-4" strokeWidth={2} />

  const dropdownTrigger = (
    <DropdownMenuTrigger asChild>
      <button
        className={buttonClass}
        aria-label={actionLabel}
        title={actionLabel}
      >
        {iconCpn}
        {!compact && <span>{label}</span>}
      </button>
    </DropdownMenuTrigger>
  )

  const contextTrigger = (
    <ContextMenuTrigger asChild>
      <button
        className={buttonClass}
        onClick={() => boardId && launchGeneration(boardId)}
        aria-label={actionLabel}
        title={actionLabel}
      >
        {iconCpn}
        {!compact && <span>{label}</span>}
      </button>
    </ContextMenuTrigger>
  )

  const withTooltip = (trigger: React.ReactNode) =>
    compact ? (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side='left'>{label}</TooltipContent>
      </Tooltip>
    ) : (
      trigger
    )

  return (
    <>
      {!boardId ? (
        <DropdownMenu>
          {withTooltip(dropdownTrigger)}
          <DropdownMenuContent className="w-48">
            <DropdownMenuLabel>Boards</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="bg-accent/50" onClick={createAndLaunch}>
              <span>Create New Board</span>
            </DropdownMenuItem>
            {boardList?.map((board) => (
              <DropdownMenuItem key={board.uid} onClick={() => launchGeneration(board.uid)}>
                {board.label || UNTITLED_LABEL}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <ContextMenu>
          {withTooltip(contextTrigger)}
          <ContextMenuContent className="w-48">
            <ContextMenuLabel>Select a different board</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem className="bg-accent/50" onClick={createAndLaunch}>
              <span>Create New Board</span>
            </ContextMenuItem>
            {boardList?.map((board) => (
              <ContextMenuItem key={board.uid} onClick={() => launchGeneration(board.uid)}>
                {board.label || UNTITLED_LABEL}
              </ContextMenuItem>
            ))}
          </ContextMenuContent>
        </ContextMenu>
      )}
    </>
  )
}
