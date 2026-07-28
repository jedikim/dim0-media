# Dim0 — Roadmap & known follow-ups

In-flight work, phased plans, and durable engineering follow-ups. Sourced from code markers, recent PR reviews, and design drafts — this **drifts**; verify against the codebase. Terminology is in [`architecture.md`](./architecture.md).

## In-flight cutovers / migrations

**North star — one agent runtime, in the browser.** The agent is migrating *entirely* to the client-side (local) engine; the server-side OpenAI-Agents runtime is being retired. End state: every chat runs the in-browser tool-calling loop against BYOK-or-managed models, and the backend keeps only the thin metered `/ai/*` proxies — no in-process agent, no `AssistantManager`/`Plan`, no server-side board writes via `AgentBoardBridge`. This is the single largest planned change in the agent domain.

- **Retire the backend agent runtime ("G5"):** the major step toward the north star — delete the server-side agent path (`POST /chats/{id}/messages`, `backend/topix/agents/` incl. `agents/assistant/`) and the browser code that drives it (`features/agent/api/send-message.ts`, `hooks/use-submit-prompt.ts`), plus the LEGACY chat-store fields it needs (`webSearchEngine`, `enabledTools`, `useDeepResearch`). Deep Research is backend-only and goes with it. The `navigate`→`fetch` tool/service rename is a mid-flight step (translated client-side today). Markers across `features/agent/store/chat-store.ts`, `api/send-message.ts`. After this, `local` on ChatContext is effectively always true and the branch collapses.
- **react-flow → canvas-harness:** the board migrated to the in-house engine; `@xyflow/react` and legacy converters (`utils/graph.ts`, deprecated `types/note.ts` fields) linger.
- **Legacy WS client → v2 offline-first sync:** `use-ws-collab.ts` (and its duplicated normalize/enrich/dedupe helpers) is retired once every synced board is `v2`; then the transient `BoardMeta.syncEngine` field and the `dim0SyncV2` localStorage override go away.

## Collaboration phases (not built)

- **Phase 3 multi-worker:** `RoomRegistry` is single-worker v1; multi-worker needs Redis room-pinning + per-peer outbox queues (sends currently block the room under `room.lock`). Soft edit-locks are also Phase 3.
- Welcome holds `room.lock` across the snapshot DB read (<500ms); a buffered-peer-op optimization is deferred.
- Bulk/import writes (the NLP parsing pipeline) bypass the `peer-op` broadcast — a live board won't see an import until reload.
- Anonymous (signed-out) share access is Phase 2+.

## Durable engineering follow-ups (from recent fixes/reviews)

- **`mini_app_state` not cascaded on `deleteBoard`** — needs a `by-board` index (record + write-path change + DB version bump). Storage leak, not data loss.
- **`enforce_rate_limit` isn't atomic** — it increments each window before a later rule rejects, so a rejected-then-retried run re-increments the minute/day counters. Fix: roll back on a later-rule reject.
- **Relay dedup is by envelope `batch.id`** — a coalesced re-send whose membership changed can re-apply an already-applied prefix. Proper fix: idempotency by covered oplog seq-range. (Benign today because the Qdrant apply is an idempotent upsert.)
- **Adopt cap advisory lock** is unit-tested only via a fake store; add a Postgres integration test for the real concurrency.
- **No cross-store (Postgres↔Qdrant) atomicity**; chunk cleanup on node delete is fire-and-forget (transient orphans).
- **No local-turn `AbortController`** — a hung turn can't be cancelled and blocks chat switching; adding it also retires the mid-stream-guard edge.
- `TODO(folder)` cluster in `store/graph.py`: no `parent_id` validation (existence / same-graph / cycle) on create/update; soft-deleted descendants aren't excluded from the descendant BFS.
- Mini-app **CSP / network-egress hardening ("Phase 4")** is deployment-delivered, not yet in the repo.
- HLC logical clock deferred to "Lift 2" (v1 relies on relay ordering). Local search-index persistence to IndexedDB is deferred. A desktop SQLite storage engine is pre-wired but not built.

## Product

- **Free tier is intentionally limited** while running on a small budget ("plan to make it more usable over time"). **Basic tier** shipped (v0.3.58: model gating + freemium limits + canvas counters).
- Tauri desktop build exists but is early (version pinned `0.1.0`, `csp:null`).

## Dead code / cleanup candidates

- `backend/topix/llm_models.yml` — superseded by `models.yml`; referenced by no Python.
- `datatypes/note/note.py` `emoji` field (→ `icon_data`); `agents/notes/tools.py` `create_note` tool (→ `write_note`); the `html-widget` skill (→ mini-app); `features/agent/local/use-local-agent.ts` (→ `use-local-submit-prompt.ts`).
