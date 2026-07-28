import { useMemo } from "react"
import type { ChatMessage } from "@/features/agent/types/chat"
import { useChat } from "@/features/agent/hooks/chat-context"
import { useChatMessages } from "@/features/agent/hooks/use-chat-messages"


/**
 * Resolves the most recent assistant message for the active chat, skipping any
 * cached placeholder data that still belongs to a previous chat. Reads the
 * local-aware message source, so it works for both backend and local engines.
 */
export const useCurrentAssistantMessage = (): ChatMessage | null => {
  const { chatId, local } = useChat()
  const messages = useChatMessages()

  return useMemo(() => {
    if (!messages?.length) return null
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (!local && m.chatUid !== chatId) continue
      if (m.role === "assistant") return m
    }
    return null
  }, [messages, chatId, local])
}
