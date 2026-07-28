import { useMemo } from "react"
import { useAppStore } from "@/store"
import type { ChatMessage } from "@/features/agent/types/chat"
import { useChatStore } from "@/features/agent/store/chat-store"
import { useLocalMessagesStore } from "@/features/agent/store/local-messages-store"
import { useListMessages } from "@/features/agent/api/list-messages"
import { useLocalMessages } from "@/features/agent/local/use-local-messages"
import { useChat } from "./chat-context"


const EMPTY: ChatMessage[] = []


/**
 * Local-aware message reader. Returns the active chat's transcript from the
 * in-browser engine store when the chat is local, otherwise from the backend
 * query. Both sources are read unconditionally (Rules of Hooks); the backend
 * query is disabled in local mode via an empty chatId. This is the single
 * switch point that lets every chat component stay transport-agnostic.
 */
export const useChatMessages = (): ChatMessage[] => {
  const { chatId, local } = useChat()
  const userId = useAppStore((s) => s.userId)
  const { data: serverMessages } = useListMessages({ chatId: local ? "" : chatId ?? "", userId })
  const localMessages = useLocalMessages()

  return useMemo(
    () => (local ? localMessages : serverMessages ?? EMPTY),
    [local, localMessages, serverMessages],
  )
}


/**
 * Local-aware streaming flag. Backend turns report streaming through the chat
 * store; the local engine marks the in-flight message instead, so derive it
 * from the local transcript when the chat is local.
 */
export const useChatStreaming = (): boolean => {
  const { local } = useChat()
  const globalStreaming = useChatStore((s) => s.isStreaming)
  const localMessages = useLocalMessages()

  return local ? localMessages.some((m) => m.streaming === true) : globalStreaming
}


/**
 * Local-aware active chat id. Backend chats track the active id on the chat
 * context; the local engine tracks it on its store. Used for layout decisions
 * (welcome vs transcript, history dropdown vs inline).
 */
export const useActiveChatId = (): string | undefined => {
  const { chatId, local } = useChat()
  const localChatUid = useLocalMessagesStore((s) => s.chatUid)
  return local ? localChatUid ?? undefined : chatId
}
