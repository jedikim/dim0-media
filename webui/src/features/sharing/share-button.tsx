import { useState } from "react"

import { ShareIcon } from "@/components/icons"
import { useBoardAppStore } from "@/features/board/harness/store/board-app-store"
import { ShareDialog } from "./share-dialog"


/**
 * "Share" button shown next to the save-status label at the canvas
 * top-right. Visible only when the signed-in user's role on the
 * current board is `"owner"` — non-owner editors and viewers don't see it.
 *
 * Styling mirrors the toolbar's active/hover pattern (transparent
 * default, secondary on hover) wrapped in the same pill chrome the
 * top-right surfaces use elsewhere (border + backdrop-blurred bg +
 * subtle shadow).
 */
export function ShareButton() {
  const boardId = useBoardAppStore((s) => s.boardId)
  const boardRole = useBoardAppStore((s) => s.boardRole)
  const boardLabel = useBoardAppStore((s) => s.boardLabel)
  const presentationMode = useBoardAppStore((s) => s.presentationMode)
  const [open, setOpen] = useState(false)

  if (!boardId) return null
  if (boardRole !== "owner") return null
  if (presentationMode) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Share this board"
        data-coachmark="share"
        className={
          "flex items-center gap-1.5 rounded-md px-1.5 py-1 " +
          "text-xs font-medium text-card-foreground " +
          "transition-opacity hover:opacity-70"
        }
      >
        <ShareIcon className="size-3.5 shrink-0" />
        Share
      </button>
      <ShareDialog
        boardId={boardId}
        boardLabel={boardLabel}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}
