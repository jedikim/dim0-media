/**
 * ChatRepo — local chat + message persistence over the `StorageEngine` port.
 *
 * Mirrors the backend `ChatStore` (minus embeddings/RAG): chats are metadata
 * rows keyed by uid and indexed by board; messages are a keyed transcript
 * ([chatUid, id]) carrying an `order` field so reads restore conversation order
 * (message ids don't sort chronologically). All logic lives here so both the
 * app (via the composition root) and the legacy functional helpers share it.
 */
import type { ChatMessage, LocalChat, LocalMessage } from "@/features/agent/types/chat"
import type { StorageEngine } from "@/features/board/persist/local/engine"


// All messages for a chat live under the compound-key prefix [chatUid, *].
const messageRange = (chatUid: string) => ({ lower: [chatUid, ""], upper: [chatUid, "￿"] })


export class ChatRepo {
  private readonly engine: StorageEngine


  constructor(engine: StorageEngine) {
    this.engine = engine
  }


  /** Fetch one chat's metadata, or undefined. */
  async getChat(chatUid: string): Promise<LocalChat | undefined> {
    return this.engine.get<LocalChat>("chats", chatUid)
  }


  /** List a board's chats, most-recently-updated first (mirrors backend `list_chats`). */
  async listByBoard(boardId: string): Promise<LocalChat[]> {
    const chats = await this.engine.list<LocalChat>("chats", {
      index: "by-board",
      range: { lower: boardId, upper: boardId },
    })
    return chats.sort((a, b) => b.updatedAt - a.updatedAt)
  }


  /** Load a chat's messages in conversation order (mirrors backend `get_messages`). */
  async getMessages(chatUid: string): Promise<ChatMessage[]> {
    const rows = await this.engine.list<LocalMessage>("chat_messages", { range: messageRange(chatUid) })
    return rows.sort((a, b) => a.order - b.order)
  }


  /**
   * Replace a chat's full transcript and upsert its metadata (optionally a label),
   * in one transaction. Preserves an existing label/createdAt when not supplied.
   */
  async saveTranscript(
    chatUid: string,
    boardId: string,
    messages: ChatMessage[],
    label?: string,
    now: number = Date.now(),
  ): Promise<void> {
    await this.engine.tx(["chat_messages", "chats"], async (t) => {
      await t.delete("chat_messages", messageRange(chatUid))
      // Stamp insertion order so reads restore conversation order (not key order).
      for (let i = 0; i < messages.length; i += 1) {
        await t.put<LocalMessage>("chat_messages", { ...messages[i], chatUid, order: i })
      }
      const prev = await t.get<LocalChat>("chats", chatUid)
      await t.put<LocalChat>("chats", {
        id: chatUid,
        boardId,
        label: label ?? prev?.label,
        // Carry the derived conversation context forward — this put REBUILDS the
        // record, so any field not copied from `prev` is silently dropped.
        context: prev?.context,
        contextTurnAt: prev?.contextTurnAt,
        contextTokenAt: prev?.contextTokenAt,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      })
    })
  }


  /**
   * Store the rolling conversation summary + its refresh gate (turn index + approx
   * token count at derive time). No-op if the chat doesn't exist yet.
   */
  async setChatContext(
    chatUid: string,
    context: string,
    gate: { turnAt: number; tokenAt: number },
    now: number = Date.now(),
  ): Promise<void> {
    // Read-modify-write in ONE transaction so it serializes against the concurrent
    // `saveTranscript` (also a chats RMW) — otherwise a next-turn save could read
    // `prev` before this write lands and clobber the just-written summary.
    await this.engine.tx(["chats"], async (t) => {
      const prev = await t.get<LocalChat>("chats", chatUid)
      if (!prev) return
      await t.put<LocalChat>("chats", {
        ...prev,
        context,
        contextTurnAt: gate.turnAt,
        contextTokenAt: gate.tokenAt,
        updatedAt: now,
      })
    })
  }


  /** Delete a chat and its entire transcript atomically. */
  async deleteChat(chatUid: string): Promise<void> {
    await this.engine.tx(["chat_messages", "chats"], async (t) => {
      await t.delete("chat_messages", messageRange(chatUid))
      await t.delete("chats", chatUid)
    })
  }


  /** Delete a single message from a chat's transcript. */
  async deleteMessage(chatUid: string, id: string): Promise<void> {
    await this.engine.delete("chat_messages", [chatUid, id])
  }
}
