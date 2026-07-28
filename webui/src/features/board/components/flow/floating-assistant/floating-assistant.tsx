import { ChatProvider } from "@/features/agent/hooks/chat-context"
import { AnswerCard } from "./answer-card"
import { FloatingIsland } from "./floating-island"


export interface FloatingAssistantProps {
  boardId: string
  currentChatId?: string
  onOpenFullSheet: () => void
  /** Run on the in-browser engine (local-first board) instead of the backend. */
  local?: boolean
}


/**
 * Ambient board assistant: a composer pill at the bottom of the canvas, an
 * adaptive progress strip, and a right-side answer card that surfaces text
 * replies. Shares the chat session with the full CopilotSheet via the
 * `current_chat_id` search param. On a local board it runs the frontend
 * engine; chat is then scoped to the board itself.
 */
export const FloatingAssistant = ({
  boardId,
  currentChatId,
  onOpenFullSheet,
  local = false,
}: FloatingAssistantProps) => {
  return (
    <ChatProvider initialChatId={local ? boardId : currentChatId} local={local}>
      <FloatingIsland boardId={boardId} onOpenFullSheet={onOpenFullSheet} />
      <AnswerCard onOpenFullSheet={onOpenFullSheet} />
    </ChatProvider>
  )
}
