/**
 * Functional chat-persistence helpers — thin wrappers over the shared `ChatRepo`.
 *
 * These keep the existing call sites stable while the storage logic lives in the
 * repo, now backed by the app-wide engine from the composition root (one shared
 * connection, no per-call opens).
 */
import { getLocalStores } from "@/features/local-stores"
import { normalizeReasoningSteps } from "@/features/agent/types/stream"
import type { ChatMessage, LocalChat } from "@/features/agent/types/chat"


/**
 * Normalize a persisted message's reasoning steps on load — folding text-like
 * "tool" steps (raw_message / synthesizer / answer_reformulate) into reasoning
 * steps, exactly as the online path does. Fixes messages saved before the local
 * step-building was aligned, which would otherwise re-render a text step as a
 * boxed "Reasoning" tool card.
 */
const normalizeMessage = (m: ChatMessage): ChatMessage => {
  const steps = m.properties?.reasoning?.reasoning
  if (!steps?.length) return m
  return {
    ...m,
    properties: { ...m.properties, reasoning: { type: "reasoning", reasoning: normalizeReasoningSteps(steps) } },
  }
}


/** Load a chat's persisted messages in conversation order. */
export const loadMessages = async (chatUid: string): Promise<ChatMessage[]> => {
  const messages = await (await getLocalStores()).chats.getMessages(chatUid)
  return messages.map(normalizeMessage)
}


/** Persist a chat's full transcript and stamp its record (optional label). */
export const saveMessages = async (
  chatUid: string,
  boardId: string,
  messages: ChatMessage[],
  label?: string,
): Promise<void> => {
  await (await getLocalStores()).chats.saveTranscript(chatUid, boardId, messages, label)
}


/** List a board's chats, most-recently-updated first. */
export const listLocalChats = async (boardId: string): Promise<LocalChat[]> =>
  (await getLocalStores()).chats.listByBoard(boardId)
