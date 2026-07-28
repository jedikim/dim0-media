import { useLocalMessagesStore } from "@/features/agent/store/local-messages-store"


/** Read the local session's chat messages (parallel to `useListMessages`). */
export const useLocalMessages = () => useLocalMessagesStore((s) => s.messages)
