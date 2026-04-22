import { useCallback } from "react"
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router"
import { useAppStore } from "@/store"
import { useChatStore } from "../store/chat-store"
import { useGraphStore } from "@/features/board/store/graph-store"
import { useChat } from "./chat-context"
import { useCreateChat } from "../api/create-chat"
import { useUpdateChat } from "../api/update-chat"
import { useSendMessage } from "../api/send-message"
import { useDescribeChat } from "../api/describe-chat"
import { ChatUrl } from "@/routes"
import { generateUuid, trimText } from "@/lib/common"
import type { SendMessageRequestPayload } from "../api/types"


type SubmitOptions = {
  forceNewChat?: boolean
  attachedBoardId?: string
  preferChatRoute?: boolean
  messageContext?: string
}


/**
 * Handles creating/naming a chat on first message, navigating to the right route,
 * and dispatching the send-message stream. Errors bubble up for callers to surface.
 */
export const useSubmitPrompt = () => {
  const { chatId, setChatId } = useChat()
  const userId = useAppStore((s) => s.userId)
  const llmModel = useChatStore((s) => s.llmModel)
  const webSearchEngine = useChatStore((s) => s.webSearchEngine)
  const enabledTools = useChatStore((s) => s.enabledTools)
  const useDeepResearch = useChatStore((s) => s.useDeepResearch)
  const setUseDeepResearch = useChatStore((s) => s.setUseDeepResearch)
  const rootId = useGraphStore((s) => s.rootId)

  const { createChatAsync } = useCreateChat()
  const { updateChatAsync } = useUpdateChat()
  const { sendMessageAsync } = useSendMessage()
  const { describeChatAsync } = useDescribeChat()

  const navigate = useNavigate()
  const routerLocation = useRouterState({ select: (s) => s.location })
  const boardParams = useParams({ from: "/boards/$id", shouldThrow: false })
  const isBoardRoute = routerLocation.pathname?.startsWith("/boards/")
  const boardRouteId = boardParams?.id

  return useCallback(
    async (text: string, options: SubmitOptions = {}): Promise<void> => {
      const {
        forceNewChat = false,
        attachedBoardId,
        preferChatRoute = false,
        messageContext,
      } = options

      const trimmed = text.trim()
      if (!trimmed) return

      const settingsBoardId = attachedBoardId ?? boardRouteId

      const createNewChat = forceNewChat || !chatId
      let id: string

      if (createNewChat) {
        const newChatId = generateUuid()
        await createChatAsync({ userId, boardId: settingsBoardId, chatId: newChatId })
        void updateChatAsync({ chatId: newChatId, chatData: { label: trimText(trimmed, 20) } }).catch(() => {})

        if (!preferChatRoute && isBoardRoute && settingsBoardId) {
          navigate({
            to: "/boards/$id",
            params: { id: settingsBoardId },
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              current_chat_id: newChatId,
            }),
          })
        } else {
          navigate({ to: ChatUrl, params: { id: newChatId } })
        }

        setChatId(newChatId)
        id = newChatId
      } else {
        id = chatId!
      }

      const payload: SendMessageRequestPayload = {
        query: trimmed,
        messageId: generateUuid(),
        rootId,
        model: llmModel,
        webSearchEngine,
        enabledTools,
        useDeepResearch,
        messageContext,
      }

      setUseDeepResearch(false)

      await sendMessageAsync({ payload, userId, chatId: id })

      if (createNewChat) {
        void describeChatAsync({ chatId: id, userId }).catch(() => {})
      }
    },
    [
      chatId,
      setChatId,
      userId,
      llmModel,
      webSearchEngine,
      enabledTools,
      useDeepResearch,
      setUseDeepResearch,
      rootId,
      boardRouteId,
      isBoardRoute,
      createChatAsync,
      updateChatAsync,
      sendMessageAsync,
      describeChatAsync,
      navigate,
    ]
  )
}
