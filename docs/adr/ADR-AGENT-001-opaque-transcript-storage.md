# ADR-AGENT-001: Store browser-agent chat transcripts as opaque JSON

**Status:** Accepted · 2026-07-30
**Applies to:** `backend/topix/store/postgres/chat_transcript.py`, `backend/topix/api/router/chats.py` (transcript routes), `webui/src/features/agent/api/chat-transcript.ts`, `webui/src/features/agent/local/seed-transcripts.ts`

## Decision
A synced board's browser-agent chat MUST be backed up by storing the client's
message array VERBATIM as opaque JSON (the `chat_transcript` table). It MUST NOT
be coerced into the server `Message` / `ReasoningProperty` model, and MUST NOT be
embedded into Qdrant. The browser is the source of truth; the server copy is
backup + cross-device seed only.

## Why
The client and server reasoning-step shapes have DRIFTED, and the server model is
strict, so coercion rejects valid turns:
- `ToolCall.name` is the `AgentToolName` enum server-side, but the client emits
  names not in it — `fetch` (the mid-flight `navigate→fetch` rename) and
  `doc_search` (a client-only tool). `Message(**msg)` then raises a
  ValidationError and the whole turn is lost.
- Client-only `ToolOutput` variants have no server union member.
- `eventMessages` (client, camelCase) vs `event_messages` (server) silently drops.

Coercing would also force an embedding we explicitly don't want (text/BM25 search
only — no vector memory). A blob round-trips exactly and lets the backend-agent
retirement (roadmap "North star") delete this path with a plain drop instead of
maintaining a translation layer that chases client drift forever.

## Consequences
- The server copy does NOT feed the server-messages UI — browser-agent chats
  render from the local IndexedDB store, so that's fine.
- Two chat representations coexist during the retirement (backend-agent chats in
  the Qdrant `Message` store; browser-agent chats as blobs). Transitional.
- `chat_transcript.board_id` uses `ON DELETE CASCADE` so transcripts don't
  outlive their board; the seed threads the server `updated_at` so reload /
  cross-device chat order is preserved (not reordered by seed-loop timing).

## Rejected alternatives
- **Reuse the server `Message` store** — the shape drift above rejects valid
  turns, and it re-couples the client to the server model exactly as we're trying
  to decouple.
- **Collab-spine (relay) storage** — deferred (`docs/plans/chat-on-sync-spine.md`):
  heavier, needs per-user filtering; REST storage is right-sized for backup.

## Verify
`grep -rn "import.*Message\|Message(" backend/topix/store/postgres/chat_transcript.py`
returns nothing — the transcript path stores raw JSON, never the `Message` model.
