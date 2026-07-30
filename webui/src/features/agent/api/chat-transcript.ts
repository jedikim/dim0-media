import { apiFetch } from "@/api"
import type { ChatMessage } from "../types/chat"


/**
 * Server-side backup for browser-agent chats on SYNCED boards (Phase 2).
 *
 * The browser engine is the source of truth; the server stores the transcript
 * verbatim as opaque JSON (no server chat model, no embedding) purely for backup
 * and cross-device seed. See `backend/topix/api/router/chats.py` transcript routes.
 */


/** A stored transcript row for a board, as returned by the list endpoint. */
export interface ServerTranscript {
  chatUid: string
  label?: string
  transcript: ChatMessage[]
  updatedAt?: string
}


/** Upsert (full-replace) a chat's transcript on the server. Owner-scoped. */
export async function putChatTranscript(
  chatUid: string,
  boardId: string,
  transcript: ChatMessage[],
  label?: string,
): Promise<void> {
  await apiFetch({
    path: `/chats/${chatUid}/transcript`,
    method: "PUT",
    body: { transcript, board_id: boardId, label },
  })
}


/** List the caller's stored transcripts for a board (cross-device seed source). */
export async function listChatTranscripts(boardId: string): Promise<ServerTranscript[]> {
  const res = await apiFetch<{
    data: {
      transcripts: Array<{
        chat_uid: string
        label?: string
        transcript: ChatMessage[]
        updated_at?: string
      }>
    }
  }>({
    path: "/chats/transcripts",
    method: "GET",
    params: { board_id: boardId },
  })
  // The transcript array is opaque client JSON — passed through untouched; only
  // the row wrapper is camelCased.
  return res.data.transcripts.map((row) => ({
    chatUid: row.chat_uid,
    label: row.label,
    transcript: row.transcript,
    updatedAt: row.updated_at,
  }))
}
