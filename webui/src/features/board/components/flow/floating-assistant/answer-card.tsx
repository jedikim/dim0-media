import { useEffect, useMemo, useState } from "react"
import { useAppStore } from "@/store"
import { Button } from "@/components/ui/button"
import { CancelPlainIcon, ExternalLinkIcon } from "@/components/icons"
import { MarkdownView } from "@/components/markdown/markdown-view"
import { cn } from "@/lib/utils"
import { useChat } from "@/features/agent/hooks/chat-context"
import { useChatStore } from "@/features/agent/store/chat-store"
import { useListMessages } from "@/features/agent/api/list-messages"
import { ResponseActions } from "@/features/agent/components/chat/actions/response-actions"
import { trimText } from "@/lib/common"


export interface AnswerCardProps {
  onOpenFullSheet: () => void
}


/**
 * Right-floating reader for the current turn's text answer. Pulses a soft ring
 * when a new answer arrives and hides while a turn is streaming. Dismissal is
 * per-message: closing the card keeps it closed until the next completion.
 */
export const AnswerCard = ({ onOpenFullSheet }: AnswerCardProps) => {
  const { chatId } = useChat()
  const userId = useAppStore((s) => s.userId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const { data: messages } = useListMessages({
    chatId: chatId ?? "",
    userId,
  })

  const [dismissedMessageId, setDismissedMessageId] = useState<string | null>(null)

  useEffect(() => {
    setDismissedMessageId(null)
  }, [chatId])

  const { assistantMessage, precedingUserPrompt } = useMemo(() => {
    if (!messages?.length || !chatId) return { assistantMessage: null, precedingUserPrompt: null }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (m.chatUid !== chatId) continue
      if (m.role === "assistant" && !m.streaming) {
        const userMsg = [...messages.slice(0, i)].reverse().find((x) => x.role === "user" && x.chatUid === chatId)
        return {
          assistantMessage: m,
          precedingUserPrompt: userMsg?.content?.markdown ?? null,
        }
      }
    }
    return { assistantMessage: null, precedingUserPrompt: null }
  }, [messages, chatId])

  if (isStreaming) return null
  if (!assistantMessage) return null
  if (dismissedMessageId === assistantMessage.id) return null

  const text = assistantMessage.content?.markdown?.trim() ?? ""
  if (!text) return null

  return (
    <div
      key={assistantMessage.id}
      className={cn(
        "fixed top-20 right-4 z-[60] w-[380px] max-w-[calc(100vw-2rem)]",
        "pointer-events-auto hidden md:block"
      )}
    >
      <div
        className='absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[calc(100%+8px)] flex flex-col items-center gap-1 p-1 bg-sidebar border border-sidebar-border rounded-lg shadow-md'
        onClick={(e) => e.stopPropagation()}
      >
        <ResponseActions message={text} layout='vertical-compact' />
      </div>
      <div
        className={cn(
          "bg-sidebar border border-sidebar-border rounded-lg shadow-lg",
          "ring-2 ring-secondary-foreground/30",
          "animate-ring-blink",
          "flex flex-col max-h-[calc(100vh-10rem)] overflow-hidden"
        )}
      >
        <div className='flex items-center justify-between gap-2 px-3 py-2 border-b border-sidebar-border/60'>
          <span
            className='text-xs text-muted-foreground font-mono truncate'
            title={precedingUserPrompt ?? undefined}
          >
            {precedingUserPrompt ? trimText(precedingUserPrompt, 60) : "Answer"}
          </span>
          <div className='flex items-center gap-0.5 shrink-0'>
            <Button
              variant='ghost'
              size='icon'
              onClick={onOpenFullSheet}
              className='size-7 text-muted-foreground hover:text-foreground'
              title='Open full chat'
              aria-label='Open full chat'
            >
              <ExternalLinkIcon className='size-3.5' strokeWidth={2} />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => setDismissedMessageId(assistantMessage.id)}
              className='size-7 text-muted-foreground hover:text-foreground'
              title='Dismiss'
              aria-label='Dismiss'
            >
              <CancelPlainIcon className='size-3.5' strokeWidth={2} />
            </Button>
          </div>
        </div>
        <div className='flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3'>
          <MarkdownView content={text} />
        </div>
      </div>
    </div>
  )
}
