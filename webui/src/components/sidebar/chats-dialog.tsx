import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router"
import { useInfiniteChats } from "@/features/agent/api/list-chats"
import { useAppStore } from "@/store"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCheckEleInView } from "@/hooks/use-check-ele-in-view"
import { trimText } from "@/lib/common"
import { UNTITLED_LABEL } from "@/features/board/const"
import { ChatHistoryIcon } from "@/components/icons"
import { cn } from "@/lib/utils"


type ChatsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, only chats attached to this board are shown. */
  boardId?: string
  title?: string
}


const formatChatDate = (value?: string) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date)
}


/**
 * Modal listing chats with infinite scroll.
 * Scopes to a single board's chats when `boardId` is set; otherwise lists
 * every board-attached chat across the workspace.
 */
export function ChatsDialog({ open, onOpenChange, boardId, title }: ChatsDialogProps) {
  const userId = useAppStore((s) => s.userId)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const routeParams = useParams({ strict: false }) as { id?: string }
  // The route's `id` is the board id when we're anywhere in the /boards/...
  // family. On other routes (e.g. /chats/$id) `id` means something else, so
  // gate on the pathname before treating it as a board id.
  const currentBoardId = pathname.startsWith("/boards/") ? routeParams.id : undefined
  const [scrollViewport, setScrollViewport] = useState<HTMLDivElement | null>(null)

  const graphUid = boardId ?? "any"
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteChats({
    pageSize: 30,
    graphUid,
    userId,
  })

  const chats = useMemo(() => data?.pages.flat() ?? [], [data])

  const { ref: sentinelRef, inView } = useCheckEleInView<HTMLDivElement>({
    root: scrollViewport,
    margin: "0px 0px -10% 0px",
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    if (!inView) return
    if (!hasNextPage) return
    if (isFetchingNextPage) return
    fetchNextPage()
  }, [open, inView, hasNextPage, isFetchingNextPage, fetchNextPage])

  const handleSelect = (chatUid: string, chatBoardId?: string) => {
    onOpenChange(false)
    if (chatBoardId) {
      // Same-board chat switch: just update the search param so any open
      // sheet/code/widget surface URL is preserved. Cross-board: navigate
      // to the new board (closing the surface is correct in that case).
      if (chatBoardId === currentBoardId) {
        navigate({
          to: ".",
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            current_chat_id: chatUid,
          }),
        })
        return
      }
      navigate({
        to: "/boards/$id",
        params: { id: chatBoardId },
        search: { current_chat_id: chatUid },
      })
    } else {
      navigate({ to: "/chats/$id", params: { id: chatUid } })
    }
  }

  const dialogTitle = title ?? (boardId ? "Chats in this board" : "All chats")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChatHistoryIcon className="size-4 shrink-0 text-secondary-foreground" strokeWidth={2} />
            <span>{dialogTitle}</span>
          </DialogTitle>
        </DialogHeader>

        <div ref={setScrollViewport} className="max-h-[60vh] overflow-y-auto scrollbar-thin">
          {chats.length ? (
            <ul className="flex flex-col gap-1 py-2">
              {chats.map((chat) => {
                const fullLabel = chat.label || UNTITLED_LABEL
                const subtitle = formatChatDate(chat.updatedAt || chat.createdAt)
                return (
                  <li key={chat.uid}>
                    <button
                      type="button"
                      onClick={() => handleSelect(chat.uid, chat.graphUid)}
                      className={cn(
                        "w-full text-left rounded-lg border border-transparent px-3 py-2 transition-colors",
                        "hover:border-border hover:bg-accent/40",
                      )}
                    >
                      <div className="text-sm font-medium truncate">{trimText(fullLabel, 80)}</div>
                      {subtitle && (
                        <div className="text-xs text-muted-foreground">{subtitle}</div>
                      )}
                    </button>
                  </li>
                )
              })}
              <li aria-hidden>
                <div ref={sentinelRef} className="h-4" />
              </li>
            </ul>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {isFetchingNextPage ? "Loading…" : "No chats yet."}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
