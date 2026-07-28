import { useState } from "react"
import { AddIcon, CancelPlainIcon, CloudArrowUpIcon } from "@/components/icons"
import { UNTITLED_LABEL } from "@/features/board/const"
import type { BoardMeta } from "@/features/board/model"
import { formatDateForUI } from "@/features/board/utils/datetime"
import { BoardKindBadge } from "@/features/board/components/board-kind-badge"
import { ConfirmDeleteBoardAlert } from "@/components/sidebar/confirm-delete-board"


// Local-board card + "new" tile, rendered by the unified BoardsHome dashboard's
// "On this device" group. (The standalone LocalDashboard screen was folded into
// BoardsHome; these leaves stayed here since that's their only consumer.)


/** A local board card: open on click, ✕ to delete (hover), double-click the title to rename. */
export function LocalBoardCard({
  board,
  onOpen,
  onDelete,
  onRename,
  onEnableSync,
  syncing = false,
}: {
  board: BoardMeta
  onOpen: () => void
  onDelete: () => void
  onRename: (title: string) => void
  onEnableSync?: () => void
  syncing?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(board.title)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const date = board.updatedAt ?? board.createdAt
  const dateString = date ? formatDateForUI(new Date(date).toISOString()) : null

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== board.title) onRename(next)
    else setDraft(board.title)
  }

  return (
    <>
    <div
      className="group relative w-64 h-60 flex flex-col justify-between gap-1 p-1 overflow-hidden rounded-xl bg-accent hover:bg-muted text-card-foreground border border-transparent hover:border-secondary-foreground hover:ring-2 hover:ring-secondary-foreground/50 shadow-md hover:shadow-lg transition-all cursor-pointer"
      onClick={() => !editing && onOpen()}
    >
      <button
        type="button"
        aria-label="Delete board"
        title="Delete board"
        className="absolute right-2 top-2 z-10 hidden rounded-md bg-background/80 p-1 text-muted-foreground shadow-sm hover:text-destructive group-hover:block"
        onClick={(e) => {
          e.stopPropagation()
          setConfirmingDelete(true)
        }}
      >
        <CancelPlainIcon className="size-3.5" strokeWidth={2} />
      </button>

      {onEnableSync && (
        <button
          type="button"
          aria-label="Enable sync"
          title="Enable sync — back up + share this board"
          disabled={syncing}
          className="absolute left-2 top-2 z-10 hidden items-center gap-1 rounded-md bg-background/80 px-1.5 py-1 text-xs text-muted-foreground shadow-sm hover:text-secondary-foreground disabled:opacity-60 group-hover:flex"
          onClick={(e) => {
            e.stopPropagation()
            onEnableSync()
          }}
        >
          <CloudArrowUpIcon className="size-3.5" strokeWidth={2} />
          {syncing ? "Syncing…" : "Enable sync"}
        </button>
      )}

      {board.thumbnail ? (
        <img
          src={board.thumbnail}
          alt={board.title || UNTITLED_LABEL}
          className="w-full h-40 object-cover rounded-md"
        />
      ) : (
        <div className="w-full h-40 bg-transparent rounded-md" />
      )}

      <div className="p-2 w-full overflow-ellipsis">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit()
              if (e.key === "Escape") {
                setDraft(board.title)
                setEditing(false)
              }
            }}
            className="w-full rounded border border-border bg-background px-1 py-0.5 text-sm"
          />
        ) : (
          <h4
            className="inline-block font-medium text-sm"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
            title="Double-click to rename"
          >
            {board.title || UNTITLED_LABEL}
          </h4>
        )}
        <div className="mt-1 flex w-full items-center justify-between gap-2">
          <BoardKindBadge kind={board.kind} />
          {dateString && (
            <span className="text-xs text-muted-foreground font-mono">{dateString}</span>
          )}
        </div>
      </div>
    </div>

    {/* Rendered OUTSIDE the clickable card: the dialog is Radix-portaled, but
        React replays synthetic events along the component tree, so a Cancel/Delete
        click inside a dialog nested in the card would bubble to onClick={onOpen}
        (opening the board on Cancel; navigating into the deleted route on Delete).
        A local board lives only in IndexedDB — deletion is irreversible, so confirm. */}
    <ConfirmDeleteBoardAlert
      open={confirmingDelete}
      onOpenChange={setConfirmingDelete}
      onConfirm={() => {
        onDelete()
        setConfirmingDelete(false)
      }}
    />
    </>
  )
}


/** The "new local board" tile. */
export function NewLocalBoardCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="w-64 h-60 flex flex-col items-center justify-center gap-1 p-1 overflow-hidden rounded-xl bg-transparent hover:bg-accent text-card-foreground border-2 border-dashed border-border hover:border-secondary-foreground hover:ring-2 hover:ring-secondary-foreground/10 shadow-none hover:shadow-sm transition-all cursor-pointer"
      onClick={onClick}
    >
      <AddIcon className="shrink-0 size-6 text-secondary-foreground" strokeWidth={2} />
      <span className="font-medium text-sm text-secondary-foreground">New Board</span>
    </div>
  )
}
