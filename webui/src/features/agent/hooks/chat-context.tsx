import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

// shape of the context: chatId value + setter, plus the local-engine flag
type ChatContextType = {
  chatId?: string
  setChatId: (id?: string) => void
  /**
   * When true, the chat runs on the frontend (local-first) engine: data hooks
   * read the local store and submit runs the in-browser agent. The single
   * switch point that keeps every chat component transport-agnostic.
   */
  local: boolean
  /**
   * When true, the browser engine runs on a SYNCED board (not a local-only
   * one), so finished turns are backed up to the server for cross-device seed.
   * Always false when `local` is a local-only board (nothing to sync to).
   */
  syncTranscript: boolean
}

// the actual context (starts undefined until provided)
const ChatContext = createContext<ChatContextType | undefined>(undefined)

// provider component: wraps children and stores chatId state
export const ChatProvider = ({
  initialChatId,
  local = false,
  syncTranscript = false,
  children,
}: {
  initialChatId?: string
  local?: boolean
  syncTranscript?: boolean
  children: ReactNode
}) => {
  const [chatId, setChatId] = useState<string | undefined>(initialChatId)

  useEffect(() => {
    setChatId(initialChatId)
  }, [initialChatId])

  return (
    <ChatContext.Provider value={{ chatId, setChatId, local, syncTranscript }}>
      {children}
    </ChatContext.Provider>
  )
}

// custom hook to consume context safely inside components
// eslint-disable-next-line react-refresh/only-export-components
export const useChat = () => {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error("useChat must be used within ChatProvider")
  return ctx
}
