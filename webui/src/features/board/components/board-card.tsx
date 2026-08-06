import { useNavigate } from "@tanstack/react-router"
import { AddIcon, CloudArrowDownIcon, CloudCheckIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import { UNTITLED_LABEL } from "../const"
import type { Graph } from "../types/board"
import { useCreateBoard } from "../api/create-board"
import { formatDateForUI } from "../utils/datetime"
import { useBoardOfflineStatus, useDownloadBoard } from "../api/board-offline-status"
import { BoardKindBadge } from "./board-kind-badge"


/** Offline status / download control for a synced board card. */
const CardOfflineBadge = ({ boardId }: { boardId: string }) => {
  const { data: offline } = useBoardOfflineStatus(boardId)
  const download = useDownloadBoard()
  // Still resolving the idb read — render nothing rather than flash the download
  // icon on a board that turns out to already be offline-available.
  if (offline === undefined) return null
  if (offline) {
    return (
      <span title="Available offline" className="text-secondary-foreground/60">
        <CloudCheckIcon className="size-4" strokeWidth={2} />
      </span>
    )
  }
  return (
    <button
      type="button"
      title={download.isPending ? "Downloading for offline…" : "Download for offline use"}
      aria-label={download.isPending ? "Downloading for offline" : "Download for offline use"}
      className={cn(
        "text-muted-foreground/50 hover:text-secondary-foreground",
        download.isPending && "opacity-60",
      )}
      onClick={(e) => {
        e.stopPropagation()
        if (!download.isPending) download.mutate(boardId)
      }}
    >
      <CloudArrowDownIcon
        className={cn("size-4", download.isPending && "animate-pulse")}
        strokeWidth={2}
      />
    </button>
  )
}


// Board card thumbnail component
export const BoardCard = ({
  board
}: {
  board: Graph
}) => {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate({ to: '/boards/$id', params: { id: board.uid } })
  }

  const date = board.updatedAt || board.createdAt || null
  const dateString = date ? formatDateForUI(date) : null

  return (
    <div
      className={`
        bg-accent hover:bg-muted
        transition-all
        rounded-xl
        text-card-foreground
        border border-transparent hover:border-secondary-foreground
        hover:ring-2 hover:ring-secondary-foreground/50
        shadow-md hover:shadow-lg
        cursor-pointer
        w-64 h-60
        flex flex-col justify-between
        overflow-hidden
        gap-1
        p-1
      `}
      onClick={handleClick}
    >
      {
        board.thumbnail ? (
          <div className='bg-transparent rounded-xl'>
            <img
              src={board.thumbnail}
              alt={board.label || UNTITLED_LABEL}
              className='w-full h-40 object-cover rounded-md'
            />
          </div>
        ) : (
          <div className='w-full h-40 bg-transparent rounded-md' />
        )
      }
      <div className='p-2 w-full overflow-ellipsis'>
        <h4 className='inline-block font-medium text-sm'>{board.label || UNTITLED_LABEL}</h4>
        <div className='mt-1 flex w-full items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <BoardKindBadge kind="synced" />
            <CardOfflineBadge boardId={board.uid} />
          </div>
          {dateString && (
            <span className='text-xs text-muted-foreground font-mono'>{dateString}</span>
          )}
        </div>
      </div>
    </div>
  )
}


// New board card component
export const NewBoardCard = () => {
  const { createBoardAsync } = useCreateBoard()
  const navigate = useNavigate()

  const handleClick = async () => {
    const newId = await createBoardAsync()
    // Go to /boards/:id (no page refresh)
    navigate({ to: '/boards/$id', params: { id: newId } })
  }

  return (
    <div
      className={`
        transition-all
        rounded-xl
        bg-transparent hover:bg-accent
        hover:ring-2 hover:ring-secondary-foreground/10
        text-card-foreground
        border-2 border-border hover:border-secondary-foreground border-dashed
        shadow-none hover:shadow-sm
        cursor-pointer
        w-64 h-60
        flex flex-col
        overflow-hidden
        gap-1
        flex items-center justify-center
        p-1
      `}
      onClick={handleClick}
    >
      <AddIcon className='shrink-0 size-6 text-secondary-foreground' strokeWidth={2} />
      <span className='font-medium text-sm text-secondary-foreground'>New Board</span>
    </div>
  )
}
