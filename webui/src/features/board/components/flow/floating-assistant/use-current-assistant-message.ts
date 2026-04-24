import { useMemo } from "react"
import { useAppStore } from "@/store"
import type { ChatMessage } from "@/features/agent/types/chat"
import { useChat } from "@/features/agent/hooks/chat-context"
import { useListMessages } from "@/features/agent/api/list-messages"


/**
 * Resolves the most recent assistant message for the active chatId, skipping
 * any cached placeholder data that still belongs to a previous chat. Shared
 * by the floating island and progress strip so their streaming signal stays
 * scoped to the current chat.
 */
export const useCurrentAssistantMessage = (): ChatMessage | null => {
  const { chatId } = useChat()
  const userId = useAppStore((s) => s.userId)
  const { data: messages } = useListMessages({ chatId: chatId ?? "", userId })

  return useMemo(() => {
    if (!messages?.length || !chatId) return null
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (m.chatUid !== chatId) continue
      if (m.role === "assistant") return m
    }
    return null
  }, [messages, chatId])
}
