import { Link, useSearch } from "@tanstack/react-router"
import { ArrowUpRightIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"

import { useGetNote } from "@/features/board/api/get-note"
import { WidgetIframe } from "@/features/board/components/flow/widget-iframe"
import { BoardUrl } from "@/routes"
import { useChat } from "../../hooks/chat-context"

type NoteWidgetPreviewProps = {
  boardId: string
  noteId: string
  pending?: boolean
}


/**
 * Renders a streaming shimmer for widget notes and a final iframe once the note is available.
 */
export const NoteWidgetPreview = ({
  boardId,
  noteId,
  pending = false,
}: NoteWidgetPreviewProps) => {
  const { chatId } = useChat()
  const { rootId } = useSearch({
    from: BoardUrl,
    select: (s: { root_id?: string }) => ({ rootId: s.root_id }),
    shouldThrow: false,
  }) ?? {}
  const { data: note, isLoading, isError } = useGetNote({
    boardId,
    noteId,
    enabled: !pending,
  })

  if (pending) {
    return (
      <div className='relative h-[260px] w-full overflow-hidden rounded-xl bg-muted/50'>
        <div className='skeleton-shimmer absolute inset-0' />
        <div className='relative z-10 flex h-full w-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground'>
          <LoaderCircleIcon className='size-5 animate-spin' />
          <span>Generating widget preview</span>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='flex h-[260px] w-full items-center justify-center rounded-xl bg-muted/40 text-sm text-muted-foreground'>
        <LoaderCircleIcon className='mr-2 size-4 animate-spin' />
        Loading widget preview
      </div>
    )
  }

  if (isError || !note || note.style.type !== "widget" || !note.content?.markdown?.trim()) {
    return (
      <div className='flex h-[260px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 text-center text-sm text-muted-foreground'>
        <TriangleAlertIcon className='size-5' />
        <span>Widget preview unavailable</span>
        <Link
          to='/boards/$id'
          params={{ id: boardId }}
          search={{
            center_around: noteId,
            current_chat_id: chatId || undefined,
            root_id: rootId || undefined,
          }}
          className='inline-flex items-center gap-1 text-xs font-medium text-secondary hover:underline'
        >
          Open on board
          <ArrowUpRightIcon className='size-3.5' />
        </Link>
      </div>
    )
  }

  return (
    <div className='w-full overflow-hidden rounded-xl bg-background'>
      <WidgetIframe
        html={note.content.markdown}
        title={note.label?.markdown || "Widget preview"}
        autoHeight
        maxHeight={800}
        minHeight={260}
        className='w-full border-0 bg-transparent rounded-sm'
      />
    </div>
  )
}
