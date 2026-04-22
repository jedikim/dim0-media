import { useState, type KeyboardEvent } from "react"
import TextareaAutosize from "react-textarea-autosize"
import { toast } from "sonner"
import { ChatHistoryIcon, SparklesIcon } from "@/components/icons"
import { ThinkingIndicator } from "@/components/animations/thinking-indicator"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { SendMessageError } from "@/features/agent/api/send-message"
import { useSubmitPrompt } from "@/features/agent/hooks/use-submit-prompt"
import { useChatStore } from "@/features/agent/store/chat-store"
import { ProgressLine } from "./progress-line"


export interface FloatingIslandProps {
  boardId: string
  onOpenFullSheet: () => void
}


/**
 * Floating composer pill anchored at the bottom-center of the board.
 * Shares the active board chat via useSubmitPrompt; errors surface as toasts.
 */
export const FloatingIsland = ({ boardId, onOpenFullSheet }: FloatingIslandProps) => {
  const [input, setInput] = useState("")
  const isStreaming = useChatStore((s) => s.isStreaming)
  const submit = useSubmitPrompt()

  const handleSubmit = async () => {
    if (isStreaming) return
    const trimmed = input.trim()
    if (!trimmed) return
    setInput("")
    try {
      await submit(trimmed, { attachedBoardId: boardId })
    } catch (error) {
      const message = error instanceof SendMessageError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Could not send message."
      toast.error(message)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div className='absolute bottom-5 left-1/2 -translate-x-1/2 z-40 w-[min(580px,calc(100vw-4rem))] pointer-events-auto hidden md:flex flex-col gap-1.5'>
      <div className={cn(
        "bg-gradient-to-r from-secondary/40 via-sidebar/60 to-sidebar/60",
        "backdrop-blur-md backdrop-saturate-150 supports-[backdrop-filter]:from-secondary/35",
        "border border-sidebar-border rounded-xl overflow-hidden flex flex-col",
        "shadow-[0_12px_32px_-4px_rgba(0,0,0,0.28),0_2px_8px_-2px_rgba(0,0,0,0.12)]",
        "dark:shadow-[0_16px_36px_-4px_rgba(0,0,0,0.55),0_2px_8px_-2px_rgba(0,0,0,0.3)]",
        "transition-[box-shadow,border-color] focus-within:border-secondary-foreground/40",
        "focus-within:ring-2 focus-within:ring-secondary-foreground/30",
      )}>
        <ProgressLine />
        <div className='flex items-center gap-3 pl-3 pr-2 py-2.5'>
          {isStreaming ? (
            <ThinkingIndicator className='text-xs text-foreground/70 shrink-0' iconSize={14} />
          ) : (
            <div className='flex items-center justify-center rounded-md bg-gradient-to-br from-wiki-link to-secondary-foreground size-7 shrink-0 shadow-sm'>
              <SparklesIcon className='size-3.5 text-primary-foreground' weight='fill' />
            </div>
          )}
          <span className='text-xs font-mono px-2 py-0.5 rounded bg-secondary text-secondary-foreground shrink-0'>
            @board
          </span>
          <TextareaAutosize
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Ask about this board, or give a task…'
            minRows={1}
            maxRows={4}
            disabled={isStreaming}
            className='flex-1 min-w-0 bg-transparent text-sm outline-none resize-none py-1 placeholder:text-muted-foreground scrollbar-thin'
          />
          <span className='shrink-0 text-sm text-muted-foreground/70 font-mono px-1 select-none hidden sm:inline'>
            ⌘↵
          </span>
          <Button
            variant='ghost'
            size='icon'
            onClick={onOpenFullSheet}
            className='shrink-0 size-7 text-muted-foreground hover:text-foreground'
            title='Open full chat'
            aria-label='Open full chat'
          >
            <ChatHistoryIcon className='size-4' />
          </Button>
        </div>
      </div>
      <p className='text-center text-[11px] text-muted-foreground/70 px-4'>
        AI can make mistakes. Verify important details carefully.
      </p>
    </div>
  )
}
