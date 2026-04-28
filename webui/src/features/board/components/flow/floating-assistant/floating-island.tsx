import { useState, type KeyboardEvent } from "react"
import TextareaAutosize from "react-textarea-autosize"
import { toast } from "sonner"
import { SparklesIcon } from "@/components/icons"
import { ThinkingIndicator } from "@/components/animations/thinking-indicator"
import { cn } from "@/lib/utils"
import { SendMessageError } from "@/features/agent/api/send-message"
import { useSubmitPrompt } from "@/features/agent/hooks/use-submit-prompt"
import { ProgressLine } from "./progress-line"
import { useCurrentAssistantMessage } from "./use-current-assistant-message"


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
  const latestAssistantMessage = useCurrentAssistantMessage()
  const isStreaming = latestAssistantMessage?.streaming === true
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
    <div className='absolute bottom-1 left-1/2 -translate-x-1/2 z-40 w-[min(580px,calc(100vw-4rem))] pointer-events-auto hidden md:flex flex-col gap-1.5'>
      <div className={cn(
        "bg-sidebar/80 backdrop-blur-md backdrop-saturate-150",
        "border rounded-2xl flex flex-col",
        "shadow-[0_12px_32px_-4px_rgba(0,0,0,0.28),0_2px_8px_-2px_rgba(0,0,0,0.12)]",
        "dark:shadow-[0_16px_36px_-4px_rgba(0,0,0,0.55),0_2px_8px_-2px_rgba(0,0,0,0.3)]",
        "transition-[box-shadow,border-color] focus-within:border-secondary-foreground/50",
        "focus-within:ring-4 focus-within:ring-secondary-foreground/20",
        isStreaming ? "border-secondary-foreground/50 animate-ring-pulse-soft" : "border-border",
      )}>
        <ProgressLine />
        <div className='flex items-center gap-2 p-3'>
          {isStreaming ? (
            <ThinkingIndicator className='text-xs text-foreground/70 shrink-0' iconSize={14} />
          ) : (
            <button
              type='button'
              onClick={onOpenFullSheet}
              title='Open full chat'
              aria-label='Open full chat'
              className='flex items-center justify-center rounded-md bg-gradient-to-br from-wiki-link to-secondary-foreground size-7 shrink-0 shadow-sm cursor-pointer transition hover:brightness-110 focus-visible:outline-none'
            >
              <SparklesIcon className='size-3.5 text-primary-foreground' weight='fill' />
            </button>
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
        </div>
      </div>
      <p className='text-center text-[11px] text-muted-foreground/70 px-3'>
        AI can make mistakes. Verify important details carefully.
      </p>
    </div>
  )
}
