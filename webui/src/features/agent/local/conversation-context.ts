/**
 * Conversation context (Phase 4) — a rolling thread summary refreshed every few
 * turns, fire-and-forget at turn end. It progressively folds recent turns into
 * `LocalChat.context` (never from-scratch), and its output doubles as the Phase 6
 * compaction checkpoint. A failed/mid-flight refresh leaves the last-good value.
 */
import type { LlmClient } from "@/features/agent/engine/types"
import { getLocalStores } from "@/features/local-stores"
import type { ChatMessage } from "@/features/agent/types/chat"


/** Run the refresh at least every N turns (secondary floor under the token gate). */
export const CONV_CTX_TURNS = 5
/** OR when the transcript grows by ~this many tokens since the last refresh. */
export const CONV_CTX_TOKENS = 3000


const CONV_CTX_PROMPT =
  "You maintain a running summary of an ongoing chat between a user and a board assistant. " +
  "Given the summary so far and the latest turns, return an updated summary in 2-5 sentences: " +
  "the user's goal, decisions made, and open threads. Keep durable facts, drop pleasantries. " +
  "Return only the summary text, no preamble."


/** Approx token count of a string (~4 chars/token; no tokenizer dependency). */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)


/** Approx tokens across a transcript (all message bodies). */
const transcriptTokens = (messages: ChatMessage[]): number =>
  estimateTokens(messages.map((m) => m.content.markdown ?? "").join("\n"))


/**
 * The turns to fold this refresh: everything since the last summarized index
 * (`sinceIndex` = the prior `contextTurnAt`), so no middle turn is skipped when
 * many accumulate between refreshes. Empty-content messages are dropped by their
 * actual body, not a rendered-line length (which silently ate short user turns).
 */
export const turnsSince = (messages: ChatMessage[], sinceIndex: number): string =>
  messages
    .slice(sinceIndex)
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.markdown.trim() !== "")
    .map((m) => `${m.role}: ${m.content.markdown.trim()}`)
    .join("\n\n")


/** Whether the thread has grown enough (turns OR token growth) to refresh. */
export const shouldRefreshConversation = (
  gate: { contextTurnAt?: number; contextTokenAt?: number },
  turns: number,
  tokens: number,
): boolean =>
  turns - (gate.contextTurnAt ?? 0) >= CONV_CTX_TURNS || tokens - (gate.contextTokenAt ?? 0) >= CONV_CTX_TOKENS


/**
 * Refresh the chat's rolling summary IF it has grown enough since the last derive.
 * Best-effort: any failure (no chat yet, model error) leaves the last-good context.
 * `llm` is injectable for tests.
 */
export const maybeRefreshConversationContext = async (
  chatUid: string,
  messages: ChatMessage[],
  llm: LlmClient | null,
): Promise<void> => {
  if (!llm || messages.length === 0) return
  try {
    const { chats } = await getLocalStores()
    const chat = await chats.getChat(chatUid)
    if (!chat) return
    const turns = messages.length
    const tokens = transcriptTokens(messages)
    if (!shouldRefreshConversation(chat, turns, tokens)) return

    // Fold every turn since the last summarized index — nothing between refreshes
    // is skipped, and the prior summary carries everything before it. Clamp the
    // index: a mid-thread delete can leave `contextTurnAt` past the current length.
    const sinceIndex = Math.min(chat.contextTurnAt ?? 0, messages.length)
    const newTurns = turnsSince(messages, sinceIndex)
    if (!newTurns) return // nothing new to fold (e.g. after a deletion)
    const input = `Summary so far:\n${chat.context ?? "(none yet)"}\n\nNew turns:\n${newTurns}`
    const turn = await llm.complete(
      [
        { role: "system", content: CONV_CTX_PROMPT },
        { role: "user", content: input },
      ],
      [],
    )
    if (turn.kind !== "text") return
    const summary = turn.text.trim()
    if (summary) await chats.setChatContext(chatUid, summary, { turnAt: turns, tokenAt: tokens })
  } catch {
    // best-effort — never disrupt the turn
  }
}
