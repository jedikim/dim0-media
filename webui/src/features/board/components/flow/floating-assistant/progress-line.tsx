import { useEffect, useMemo, useRef, useState } from "react"
import { useAppStore } from "@/store"
import { ShinyText } from "@/components/animations/shiny-text"
import { useChat } from "@/features/agent/hooks/chat-context"
import { useListMessages } from "@/features/agent/api/list-messages"
import { isToolCallStep, ToolNameIcon } from "@/features/agent/types/stream"
import type { ToolCallStep } from "@/features/agent/types/stream"
import { getToolTitle } from "@/features/agent/utils/stream/build"


const DWELL_MS = 4000


/**
 * Adaptive progress strip under the island input. Shows a "Thinking" shimmer
 * when streaming without an active tool, the current tool's icon + title while
 * a tool runs, and lingers on the last tool for a short dwell after the turn
 * ends. Scoped to the current chatId so cache bleed from other chats is
 * discarded on switch.
 */
export const ProgressLine = () => {
  const { chatId } = useChat()
  const userId = useAppStore((s) => s.userId)
  const { data: messages } = useListMessages({
    chatId: chatId ?? "",
    userId,
  })

  const latestAssistantMessage = useMemo(() => {
    if (!messages?.length || !chatId) return null
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (m.chatUid !== chatId) continue
      if (m.role === "assistant") return m
    }
    return null
  }, [messages, chatId])

  const isThisChatStreaming = latestAssistantMessage?.streaming === true

  const currentReasoning = useMemo(
    () => latestAssistantMessage?.properties?.reasoning?.reasoning ?? [],
    [latestAssistantMessage]
  )

  const activeTool = useMemo<ToolCallStep | null>(() => {
    if (!isThisChatStreaming) return null
    for (let i = currentReasoning.length - 1; i >= 0; i -= 1) {
      const step = currentReasoning[i]
      if (isToolCallStep(step) && step.state === "started") return step
    }
    return null
  }, [isThisChatStreaming, currentReasoning])

  const lastToolInTurn = useMemo<ToolCallStep | null>(() => {
    for (let i = currentReasoning.length - 1; i >= 0; i -= 1) {
      const step = currentReasoning[i]
      if (isToolCallStep(step)) return step
    }
    return null
  }, [currentReasoning])

  const [dwelledTool, setDwelledTool] = useState<ToolCallStep | null>(null)
  const prevStreaming = useRef(isThisChatStreaming)

  useEffect(() => {
    setDwelledTool(null)
    prevStreaming.current = false
  }, [chatId])

  useEffect(() => {
    const wasStreaming = prevStreaming.current
    prevStreaming.current = isThisChatStreaming

    if (isThisChatStreaming && !wasStreaming) {
      setDwelledTool(null)
      return
    }

    if (wasStreaming && !isThisChatStreaming && lastToolInTurn) {
      setDwelledTool(lastToolInTurn)
      const timer = setTimeout(() => setDwelledTool(null), DWELL_MS)
      return () => clearTimeout(timer)
    }
  }, [isThisChatStreaming, lastToolInTurn])

  if (isThisChatStreaming && activeTool) {
    const Icon = ToolNameIcon[activeTool.name]
    return (
      <div className='flex items-center gap-2 px-4 py-2 border-b border-sidebar-border/60 bg-muted/60'>
        <Icon className='size-3.5 text-wiki-link shrink-0' strokeWidth={2} />
        <span className='truncate font-mono text-xs text-muted-foreground'>
          {getToolTitle(activeTool.name)}
        </span>
      </div>
    )
  }

  if (isThisChatStreaming) {
    return (
      <div className='flex items-center gap-2 px-4 py-2 border-b border-sidebar-border/60 bg-muted/60'>
        <ShinyText text='Thinking' speed={3} className='text-xs text-foreground/50' />
      </div>
    )
  }

  if (dwelledTool) {
    const Icon = ToolNameIcon[dwelledTool.name]
    return (
      <div className='flex items-center gap-2 px-4 py-2 border-b border-sidebar-border/60 bg-muted/60 transition-opacity'>
        <Icon className='size-3.5 text-muted-foreground shrink-0' strokeWidth={2} />
        <span className='truncate font-mono text-xs text-muted-foreground'>
          {getToolTitle(dwelledTool.name)}
        </span>
      </div>
    )
  }

  return null
}
