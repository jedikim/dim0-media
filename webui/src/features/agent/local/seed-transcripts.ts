import { listChatTranscripts } from "@/features/agent/api/chat-transcript"
import { loadMessages, saveMessages } from "@/features/agent/store/chat-persist"
import { agentLog } from "@/features/agent/engine/debug"


/**
 * Seed a synced board's local chat store from the server's transcript backup
 * (Phase 2 cross-device). Best-effort: on another device the board has no local
 * chats yet, so pull each server transcript into IndexedDB before `openBoard`
 * loads the list.
 *
 * Only writes a chat the local store doesn't already have — the browser engine
 * is the source of truth, so a present local transcript (possibly newer, e.g.
 * mid-session on this device) is never clobbered by the server copy. Network or
 * auth failures are swallowed: seeding is an enhancement, not a requirement.
 */
export async function seedTranscriptsFromServer(boardId: string): Promise<void> {
  try {
    const rows = await listChatTranscripts(boardId)
    for (const row of rows) {
      if (!row.transcript?.length) continue
      const existing = await loadMessages(row.chatUid)
      if (existing.length > 0) continue // keep the local copy
      // Preserve the server's recency stamp: `openBoard` selects the newest chat
      // and the history list sorts by `updatedAt`, so seeding with the loop's own
      // clock would reorder chats (and auto-select the wrong one).
      const parsed = row.updatedAt ? Date.parse(row.updatedAt) : NaN
      const updatedAt = Number.isNaN(parsed) ? undefined : parsed
      await saveMessages(row.chatUid, boardId, row.transcript, row.label, updatedAt)
    }
  } catch (e) {
    agentLog.error("seedTranscriptsFromServer", e)
  }
}
