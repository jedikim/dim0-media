# Agent context & memory — design (discussion draft)

> **SUPERSEDED.** This is the earliest discussion draft; the `DECISION?`/`LEAN:` forks below were
> resolved in **[`agent-context-architecture.md`](./agent-context-architecture.md)**, which is the
> single source of truth for the design. Where the two disagree, the architecture doc wins — notably
> the **memory sync model**: this draft leans toward an opaque per-board *blob* backup, but the
> resolved design is **per-record sync with per-record LWW** (board memory is shared across
> collaborators, so a blob would clobber concurrent writes). Kept for the reasoning trail; do not
> implement from it.

Status: **draft, for discussion.** Nothing here is committed. `DECISION?` marks an
open fork we need to resolve together; `LEAN:` is my current recommendation.

## Goal (one line)

Give the board agent a **layered, curated, read+write memory** plus a cheap
**auto-built board snapshot**, so every run starts already knowing (a) the state
of the board now, (b) durable facts about this board, and (c) durable facts about
the user across all boards — the way Claude Code assembles `gitStatus` + `CLAUDE.md`
+ a relevance-retrieved memory dir.

Runtime is the **browser engine** (`webui/src/features/agent/engine/`), the north-star
runtime. Persistence is **front-end-first**: the same local DB the runtime lives on
(IndexedDB on web, rusqlite on desktop) via the existing `StorageEngine` port. The
server (Qdrant today, a blob layer later) is only a **sync/backup target** for synced
boards and cross-device — never the primary store.

## Prior art: how Claude Code's memory works (what we're stealing)

Five transferable ideas (from the leaked `memdir/` + `services/extractMemories/`):

1. **Two-tier storage: always-loaded index + on-demand fact files.** `MEMORY.md` is a
   capped index (200 lines / 25KB, hard-truncated) that's *always* in the prompt; each
   fact is a separate file (`name`, `description`, `type` frontmatter). The index keeps
   the always-on cost flat while the memory grows unbounded.
2. **Closed 4-type taxonomy** — `user` / `feedback` / `project` / `reference` — governed
   by one rule that does most of the work: **never save what's derivable from current
   state** (for us: derivable from reading the board — that's the snapshot's job).
3. **Relevance retrieval is a cheap LLM side-query, not embeddings.** Scan headers
   (name + description) → hand the manifest to a small fast model → "pick ≤5 you're
   *certain* are useful" → inject only those full files.
4. **Write-back is prompted, two-step, dedup-first** (write fact file, then index
   pointer; update-before-create), plus a passive `extractMemories` pass over the
   transcript.
5. **Drift discipline on recall**: memory is "true as of when written" — verify against
   current state before acting, trust what you observe now, update/remove stale entries.

## The three layers

| Layer | CC analogue | Nature | Persistence |
|---|---|---|---|
| **L0 — Board snapshot** | `gitStatus` | Auto, ephemeral, frozen per run | none (computed from live scene) |
| **L1 — Board memory** | project/feedback memories + `CLAUDE.md` | Curated read+write, board-scoped | local DB, synced per-board |
| **L2 — Global memory** | user-level memory | Curated read+write, account-wide | local DB, backed up per-user |

### L0 — Board snapshot (build first; almost free)

Computed from the live harness store at run start, frozen for the run (memoized like
`getSystemContext`), injected as a labeled block: *"snapshot in time, will not update
during this run."* Contents (budgeted, ~1–2k tokens):

- Node inventory by type + counts (notes, folders, sheets, code-sandboxes, mini-apps, docs).
- Titles / short captions of nodes (truncated list; the whole board if small).
- Current selection + which folder layer (`rootId`) is projected.
- Optionally: recently-changed nodes (from the oplog tail).

`DECISION?` How big is the snapshot allowed to get on a large board — hard node cap +
"N more not shown", or a summarize-the-board pass for big boards? `LEAN:` hard cap first
(cheap, deterministic); a summarizer is a later enhancement.

### L1 — Board memory (curated, board-scoped)

Durable facts about *this board*: its purpose, the user's intent for it, conventions
("keep research notes in the left cluster"), decisions, references. Excludes anything
readable from the board itself.

### L2 — Global memory (curated, account-wide)

Durable facts about the *user* that should travel across every board: role, expertise,
collaboration preferences, feedback ("don't auto-create summary notes"), cross-board
references. This is the `user`/`feedback` taxonomy.

`DECISION?` Do we keep CC's exact 4 types (`user`/`feedback`/`project`/`reference`), or
add a board-native one (e.g. `board` for "what this canvas is")? `LEAN:` reuse the 4;
map "what this board is" to `project` scoped to the board. Fewer concepts.

## Storage model (front-end-first)

### The record

One store, `memories`, over the `StorageEngine` port — a new `MemoryRepo` composed in
`local-stores.ts` beside `ChatRepo`/`DocRepo`. Record shape:

```ts
type MemoryRecord = {
  id: string                 // uuid, key path
  scope: "global" | "board"
  boardId: string | null     // set iff scope === "board"; null for global
  type: "user" | "feedback" | "project" | "reference"
  name: string               // short slug/title
  description: string        // one-line — THE retrieval key (matches CC frontmatter)
  body: string               // the fact; feedback/project carry Why: / How to apply:
  createdAt: number
  updatedAt: number
  // sync bookkeeping (see below)
  dirty: boolean             // has local edits not yet backed up
  serverRev: number | null   // last synced revision, null = never synced
}
```

Indexes: `by-scope-board` (`[scope, boardId]`) for "all memories for this board" and
"all global memories"; `by-type` optional. Mirrors `DocRepo`'s `by-board` pattern; the
engine already supports compound-key ranges (see `engine-contract.ts`).

There is **no separate `MEMORY.md` file** as in CC — the "always-loaded index" is
*derived* at assembly time by listing records and rendering their `name`+`description`
+`type`. Same effect, no second artifact to keep in sync. The 200-line/25KB cap becomes
a budget on how many index lines we render (oldest/least-relevant dropped, with a
"N more not shown" note).

### Sync / backup

Retrieval and index-building are **entirely front-end** — the server never needs to
understand memory semantics, only store and return opaque bytes. So model both layers
on the **opaque-blob backup** pattern already used for browser-agent transcripts
(ADR-AGENT-001), not on the collab oplog:

- **L2 global:** one per-user memory blob (all global records), backed up to the server
  keyed by `userId`. Pulled on login/first-open, pushed (debounced) when `dirty`. Merge
  is last-writer-wins per record (`updatedAt`), same discipline as the sync spine.
  Anonymous users: local-only, no backup (no identity — acceptable, matches CC's
  "no account, no cross-device").
- **L1 board:** one per-board memory blob keyed by `boardId`, backed up alongside the
  board. Local boards: local-only. Synced boards: backed up so the same user's other
  devices get it.

`DECISION?` For a **synced/shared** board, should board memory be **collaborative**
(every member sees the same memory, live) or **per-user-per-board** (my notes on this
board are mine)? Collaborative ⇒ it must ride the board relay/oplog as a new op type
(touches ADR-SYNC-001 invariants). Per-user ⇒ the opaque-blob backup above, keyed by
`(userId, boardId)`, and collab is untouched. `LEAN:` **per-user-per-board via blob
backup** for v1 — keeps collab invariants untouched, ships faster; collaborative shared
memory is a clean follow-up (it's "team memory" — CC gates that behind a flag too).

`DECISION?` Blob backup vs proper per-record server rows. Blob = trivial server, coarse
merge; rows = finer merge, more backend. `LEAN:` blob for v1 (memory writes are rare and
small; coarse LWW is fine), revisit if merge conflicts bite.

## Retrieval (front-end)

At run start, for the current user message:

1. **Index (always in prompt):** render every global + this-board record as one line
   (`- [type] name — description`), budget-capped. This is the `MEMORY.md` equivalent.
2. **Relevant full memories:** CC's `findRelevantMemories` — build a manifest from the
   records' `name`+`description`, call a cheap model via the `/ai/llm` proxy with a
   strict "pick ≤5 certain-useful" prompt, inject those full bodies.

`DECISION?` Do we need the LLM-select at all for v1, or just inject the whole index
(names+descriptions) and let the main model ask for bodies via a `read_memory` tool?
`LEAN:` start with **index-always + a `recall_memory` tool** (model pulls bodies on
demand) — simplest, no extra model call per run. Add the automatic LLM-select later when
memory volume makes the index too big to always show. (We also already have Orama BM25
from doc Q&A as a future pre-filter if volume explodes.)

## Write path

New browser-engine tools (fit the ADR-AGENT-002 tool contract — one `ToolFailure` shape):

- `save_memory({ scope, type, name, description, body })` — dedup-first (update existing
  by name+scope before creating).
- `update_memory({ id, ... })`, `delete_memory({ id })`, `recall_memory({ query })`.

`DECISION?` Also run a **passive post-run extraction pass** (CC's `extractMemories`) that
mines the finished turn for durable facts? Pro: catches what the model forgets to save.
Con: an extra metered `/ai/llm` call per run. `LEAN:` **tools only for v1**; add extraction
behind a flag once the tool path is proven.

## Assembly / injection

New module `features/agent/engine/context/` mirroring CC's `context.ts`:

- `getBoardSnapshot(store)` → L0, memoized per run.
- `getMemoryContext(userId, boardId, query)` → L1+L2 index (+ optional relevant bodies).
- Both assembled into the system prompt at `agent-loop.ts` start, frozen for the run.

Prompt scaffolding (taxonomy text, what-not-to-save, drift caveat, how-to-save) is
adapted from CC's `memoryTypes.ts` — that text is eval-tuned; we should port it near-verbatim
and trim the team/scope branches we don't use in v1.

## Phasing

1. **L0 board snapshot** — pure win, no persistence, immediately useful.
2. **MemoryRepo + `memories` store + schema/migration** — local only, no sync.
3. **Write tools + index injection + `recall_memory`** — memory usable on local boards.
4. **Backup/sync** — L2 per-user blob, then L1 per-board blob.
5. **(later)** automatic LLM-select retrieval; passive extraction; collaborative board memory.

## Open questions (consolidated)

1. Snapshot size strategy on large boards — hard cap vs summarizer.
2. Taxonomy — CC's 4 types as-is, or add a board-native type.
3. Shared-board memory — collaborative (relay) vs per-user (blob). *(biggest one)*
4. Backup granularity — opaque blob vs per-record rows.
5. Retrieval — index-always + tool vs automatic LLM-select from day one.
6. Extraction — tools-only vs passive post-run pass.
