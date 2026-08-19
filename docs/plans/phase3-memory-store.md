# Phase 3 — memory store + tools (implementation plan)

Give the browser agent **durable facts** it writes and reads across turns and sessions: a local
`MemoryRepo` (board + global scope), the `save/update/delete/recall_memory` tools, an always-on
memory index injected into the system prompt, and the WHEN/SKIP guidance that governs writes. This is
the core of task 1 (the agent *remembers*). Schema shapes, write-path triggers, and the sync design
live in [`agent-context-architecture.md`](./agent-context-architecture.md) §1.1 / Part 3 (Board
memory & Sync) / Part 5 and are **not** restated here — this doc is the grounded, file-by-file build.

## Scope of THIS PR

**In:** the local `MemoryRepo` over the existing `StorageEngine`, the four tools bound to
scope/board from context, always-on index injection + fencing, prompt guidance, the DB migration, and
a **minimal read-only viewer** (indicator + list).

**Out (later phases):** sync to server (Phase 7 — shared board memory / per-user global; the record
already carries `dirty`/`serverRev`/`deleted` for forward-compat, but no push/pull code ships here),
board purpose + conversation context (Phase 4), the turn-end extraction backstop (Phase 7), and the
full editable panel (viewer is read-only in v1).

Because sync is out, **global memory is a single per-device bucket** this PR — `userId` matters only
for Phase 7 sync and is not threaded through the repo yet.

## Data model

`MemoryRecord` is per [§1.1](./agent-context-architecture.md). One deliberate deviation from the doc's
`by-scope-board = [scope, boardId]` index, forced by the real storage layer:

- IndexedDB **drops records whose indexed keyPath is null**, and global memories have `boardId: null`
  — so a `[scope, boardId]` compound index would never return global records. The existing index
  system (`schema.ts` `indexes: Record<string, string>`) also indexes a **single** field, mirroring
  `DocRepo`'s `by-board`.
- **Decision:** add a computed `bucket` field on the record and index it (`by-bucket`):
  `bucket = scope === "board" ? \`board:${boardId}\` : "global"`. One string index, no null-key trap,
  no schema-type change, same idiom as `documents`/`chunks`. `list(scope, boardId)` becomes an
  `eq(bucket)` range query. At this cardinality (≤4000 chars/scope ≈ tens of records) even a full
  `getAll` + filter would do; the index just keeps it tidy.

Caps and dedup are per the doc: `BOARD_MEM_CHARS = GLOBAL_MEM_CHARS = 4000`, additive writes with
`hash` dedup, overflow → reject-and-return-entries so the model consolidates in-turn.

## Changes (file by file)

| # | File | Change |
|---|---|---|
| 1 | `board/persist/local/engine.ts` | add `"memories"` to the `Collection` union |
| 2 | `board/persist/local/schema.ts` | add `memories: { keyPath: "id", indexes: { "by-bucket": "bucket" } }` |
| 3 | `board/persist/local/idb.ts` | add `MemoryRecord` type + `memories` to the `Dim0DB` schema interface; **bump `DB_VERSION` 7 → 8** (the upgrade loop is idempotent — it creates the missing store/index; no data migration needed, existing stores untouched) |
| 4 | `board/persist/local/memory-repo.ts` (new) | `MemoryRepo` over `StorageEngine` (mirror `DocRepo`): `add` (cap + hash dedup → `{ok:false, reason:"over_cap", entries}` on overflow), `update`, `remove` (soft-delete tombstone), `list(scope, boardId)`, `findByHash`, `charCount` |
| 5 | `features/local-stores.ts` | compose `memories: new MemoryRepo(engine)` beside `docs` |
| 6 | `agent/engine/types.ts` | add `memory?: MemoryRepo` to `ToolContext` |
| 7 | `agent/engine/tools.ts` | `saveMemory` / `updateMemory` / `deleteMemory` / `recallMemory` via `defineTool`; each **binds `scope`+`boardId` from ctx** (model passes only `scope`, `kind`, content — never an id it could use to cross scopes) |
| 8 | `agent/local/agent-event-to-step.ts` | map the memory tools to a UI tool name/output (a "saved to memory" step; reuse the generic tool card) |
| 9 | `agent/local/use-local-submit-prompt.ts` | assemble the memory index (board ∪ global) + inject as a fenced `## MEMORY` block beside `## BOARD`; pass `memory` on the runAgent ctx |
| 10 | `agent/prompts/plan-system.md` (+ `prompts/index.ts` if a placeholder is used) | `## MEMORY` section + WHEN/SKIP guidance + the retry-on-overflow contract |
| 11 | minimal viewer (new small component + indicator) | read-only list of stored facts for the board ∪ global, opened from a subtle indicator; no edit/delete UI in v1 |

## Tool contract (what the model sees)

- `save_memory({ scope: "board"|"global", kind, title, summary, body })` → `{ ok }` or
  `{ ok:false, reason:"over_cap", entries:[…] }` (model then `update`/`delete`s and retries, ≤3).
- `update_memory({ id, …patch })`, `delete_memory({ id })` — `id` is one the model saw in the index
  or a `recall`/over-cap return, always within its own scope.
- `recall_memory({ scope?, query? })` → matching records (always-on index means recall is rarely
  needed; kept for large sets / explicit lookups).
- The tools are **auto-run, no confirm gate** — local data, not off-board egress (contrast the
  `web_search`/`fetch`/`code` gate). Writes are silent-but-inspectable via the viewer.

## Index injection + fencing

Always-on: every turn, `list` board ∪ global, render a compact block (title + one-line summary per
record, capped), inject as `## MEMORY`. **Fence** the block (it contains model-written text that
could carry injected instructions) the same way the docs/board context is bounded — memory is data,
not instructions.

## Tests

- **`memory-repo.test.ts`** (against the in-memory `StorageEngine`, the `engine-contract` trick — no
  IndexedDB): add/list round-trips; scope isolation (board A vs board B vs global never bleed via
  `bucket`); hash dedup (same normalized body → no duplicate); over-cap → `{ok:false}` + entries
  returned, nothing written; soft-delete tombstone hides from `list` but persists; `charCount`.
- **`tools` test**: `save_memory` binds ctx scope/boardId (model-supplied id/boardId can't
  cross-contaminate); over-cap surfaces the structured retry payload; `recall` filters by scope.
- **`agent-event-to-step` test**: a memory tool call renders as a memory step, not a raw_message.
- **Migration guard**: opening at v8 creates `memories` without disturbing existing stores (idempotent
  upgrade loop) — a getAll on a pre-existing store still returns its rows.

## Estimate

~500–700 impl LoC + ~350 test (per the roadmap). Complexity **Med–High** — the **DB version bump**
and the **dedup/overflow** semantics are the correctness-sensitive parts; run the behavioral store
tests against the new repo. Inline writes only, no background pass.

## Sequencing

No hard deps (roadmap: Phases 1–3 independent). Phase 4 reuses this repo/persistence pattern; Phase 7
adds sync on top of the forward-compat fields already in `MemoryRecord`.
