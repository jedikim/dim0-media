# ADR-SEARCH-001: Local document Q&A — managed OCR, offline BM25 index, no vector store

**Status:** Accepted · 2026-07-31
**Applies to:** `webui/src/features/agent/engine/doc-parse.ts`, `webui/src/features/agent/engine/doc-chunk.ts`, `webui/src/features/agent/engine/doc-search.ts`, `webui/src/features/agent/local/ingest-doc.ts`, `webui/src/features/board/search/**`, `backend/topix/api/router/ai.py` (`/ai/parse`)

## Decision
Document Q&A MUST run client-side with a **full-text BM25** index and **no vector
store / no server embeddings** for local search:

- **Parse** PDFs via the managed `/ai/parse` relay (Mistral OCR) — browsers can't
  OCR. Same resolution as other services (managed-first, BYOK `X-Provider-Key`
  fallback on `429`, `off` greys out upload). The backend is PDF-only, size/page
  capped, and MUST NOT persist the bytes (the client owns the markdown).
- **Chunk** markdown client-side (`doc-chunk.ts`, ~1200 chars / 150 overlap) and
  store `documents` + `chunks` in IndexedDB (`DocRepo`, transactional cascade).
- **Index** chunks in a per-board **Orama BM25** index (`board/search/doc-index.ts`),
  separate from the notes index. It is a derived read-model: rebuilt from `DocRepo`
  on board load and after every upload.
- **Retrieve** via the `doc_search` tool, offered to the agent **only** when the
  board has indexed chunks; results carry `docId`/`docTitle`/`chunkId` for exact
  citations.

Ingest invariants (MUST): title is unique per board and a same-title re-upload
**reuses the existing `docId`** (prior citations stay valid); an unreadable PDF
(0 chunks) MUST NOT persist (so a bad re-upload never wipes a good version).

## Why
The pre-#154 design used server-side semantic memory (embeddings + vector search).
Local-first has no server to embed against, and BM25 over the user's own documents
is good enough for grounded Q&A while keeping everything **on-device** and
**offline** — no content leaves the browser except the one OCR call, which needs a
capability the browser lacks. Keeping the `search_notes`/`doc_search` **tool shape
identical** to a future filesystem+grep backend is deliberate: the desktop build
(Tauri) swaps Orama for filesystem+ripgrep without the agent noticing. (This is
decision "D2" from `docs/plans/retire-backend-agent.md`, promoted to an ADR so it
is durable rather than living only in a plan.)

## Consequences
- No semantic/vector recall; retrieval is lexical. A hybrid/vector upgrade is left
  as a seam, not built.
- Two independent Orama indexes with distinct lifecycles: notes (incremental via
  store `change` events) and doc chunks (rebuilt). Each is published via a
  module-level ref (one active board at a time).
- OCR is the only server touch in the doc path and is metered like any `/ai/*` call
  (see [`ADR-AGENT-003`](./ADR-AGENT-003-service-resolution-and-metering.md)).
- Chunk storage + cascade shape → [`offline-first-data-model.md`](../offline-first-data-model.md).

## Rejected alternatives
- **Server-side embeddings / vector store** — needs a server the local-first and
  desktop builds don't have, and ships user content off-device.
- **Parse in the browser** — no viable client PDF-OCR; OCR must be the one relayed
  capability.
- **A single combined notes+docs index** — different schemas, sources, and refresh
  cadences; two indexes keep each lifecycle simple.

## Verify
`grep -rn "Orama\|create(" webui/src/features/board/search/doc-index.ts` — BM25 text index, no vector field.
`grep -rn "count()\|hasDocs\|doc_search" webui/src/features/agent/local/use-local-submit-prompt.ts` — the tool is offered only when indexed chunks exist.
