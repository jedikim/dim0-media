import { useChatMessages, useChatStreaming } from "../../hooks/use-chat-messages"
import { UserMessage } from "./user-message"
import { AssistantMessage } from "./assistant-message"
import type { ChatMessage } from "../../types/chat"
import { ThinkingIndicator } from "@/components/animations/thinking-indicator"


/**
 * MessageView component renders a chat message based on its role.
 */
const MessageView = ({
  chatMessage,
  isLatestUserMessage,
}: { chatMessage: ChatMessage, isLatestUserMessage: boolean }) => {
  switch (chatMessage.role) {
    case "user":
      return (
        <UserMessage
          message={chatMessage}
          isLatest={isLatestUserMessage}
        />
      )
    case "assistant":
      return <AssistantMessage
        message={chatMessage}
      />
    default:
      return null
  }
}

const EMPTY_MESSAGES: ChatMessage[] = []


/**
 * TrailingAssistantIndicator shows the cycling thinking animation while the
 * turn is streaming and collapses to nothing once the turn ends.
 */
const TrailingAssistantIndicator = ({ isStreaming }: { isStreaming: boolean }) => {
  if (!isStreaming) return null

  return (
    <div className='w-full flex justify-start mt-2'>
      <ThinkingIndicator className='text-sm text-foreground/60' iconSize={18} />
    </div>
  )
}

/**
 * Conversation component displays a chat conversation by reading the active
 * chat's messages (local-aware) and rendering them by role. The chat is
 * scoped by the surrounding ChatProvider (backend or local engine).
 */
export const Conversation = () => {
  const isStreaming = useChatStreaming()

  const messages = useChatMessages() || EMPTY_MESSAGES

  const userMessages = messages?.filter((m) => m.role === "user")
  const lastUserMessageId = userMessages?.at(-1)?.id

  const items = messages.map((message) => (
    <MessageView
      key={message.id}
      chatMessage={message}
      isLatestUserMessage={message.id === lastUserMessageId}
    />
  ))

  return (
    <>
      <div className='mt-32 flex flex-col items-end space-y-1'>
        {items}
        {messages.length > 0 && <TrailingAssistantIndicator isStreaming={isStreaming} />}
        <div className='h-screen'>
        </div>
      </div>
    </>
  )
}
