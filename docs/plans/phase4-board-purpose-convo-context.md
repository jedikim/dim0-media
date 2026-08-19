# Phase 4 — board purpose + conversation context (implementation plan)

Two derived, standing context fields with their gated refresh passes: a **board purpose** (what this
board is about, re-derived when the board drifts) and a **conversation context** (a rolling thread
summary, refreshed every few turns). Both are injected into the system prompt so the agent carries
semantic context, not just the deterministic snapshot. Schema shapes, the drift-signal design, and
the gate rationale live in [`agent-context-architecture.md`](./agent-context-architecture.md) §1.2 /
§1.3 / Part 3 (Board purpose · Conversation context) and are **not** restated here.

Reuses Phase 3's repo/persistence idiom and the existing turn-end derive scaffolding
(`describe-board.ts`, which already runs a small-model call fire-and-forget after `done`).

## Scope of THIS PR

**In:** the two schema fields + their setters, the deterministic board-drift gate, the two turn-end
derive passes (fire-and-forget), and injection of both into the system prompt.

**Out:** compaction (Phase 6 reuses `LocalChat.context` as its checkpoint — this PR only *produces*
it). Cross-device board purpose (the drift seq is per-device — device-local derive is fine for v1,
per §1.2 caveat). No new tools; these are automatic derives, not model-callable.

## The two derives at a glance

| | Board purpose | Conversation context |
|---|---|---|
| Stored on | `BoardMeta.context` (+ `contextDerivedAt`, `contextDeriveSeq`) | `LocalChat.context` (+ `contextTurnAt`, `contextTokenAt`) |
| Fires | turn end, **only if the board was used this turn** | turn end |
| Gate (deterministic) | drift: `charsChanged ≥ CHARS` **OR** `nodesTouched ≥ NODES` **OR** stale by `DAYS` **OR** never derived | `turnsSince ≥ CONV_CTX_TURNS` **OR** `tokenGrowth ≥ CONV_CTX_TOKENS` |
| Runs | 1 small-model call re-summarizing current board state → 1–2 sentence purpose | 1 small-model call folding recent turns into the rolling summary |
| Persist | write context, stamp `contextDerivedAt=now`, `contextDeriveSeq=maxSeq` (resets drift baseline) | write context, stamp `contextTurnAt`, `contextTokenAt` |

Both are **fire-and-forget after `done`** (never block the reply); a failed/mid-flight refresh leaves
the **last-good** value in place (never an empty checkpoint).

## The drift gate (board purpose) — deterministic, no LLM

Reuses the snapshot's `readRecentOps(engine, boardId, sinceSeq)` (already the Phase 1 oplog reader).
One pass over the ops since `contextDeriveSeq` computes both metrics:

- **`charsChanged`** (primary) — content mass added/edited (`node.add` → label+content size; `node.update`
  → approx patch size). A better proxy than node-count for a *content* summary and unifies with the
  conversation gate (also growth-based).
- **`nodesTouched`** (OR fallback) — distinct nodes touched, so deletes + structural churn that
  char-counting can't see still trip the gate.
- **time floor** (`DAYS`) — guarantees an eventual refresh under slow semantic drift.

**Agent mid-turn writes are real ops and count.** To avoid a big build turn re-deriving against its
own writes, the baseline is stamped to the **current max seq at derive time**, so a build's drift is
measured from *after* that turn (defers its re-derive to the next turn — cleaner batching, per §Part 3).

Proposed constants (tune later): `BOARD_DRIFT_CHARS = 1500`, `BOARD_DRIFT_NODES = 8`,
`BOARD_DRIFT_DAYS = 14`, `CONV_CTX_TURNS = 5`, `CONV_CTX_TOKENS = 3000`. Token growth is estimated
`chars / 4` over the transcript (no tokenizer dep).

## Changes (file by file)

| # | File | Change |
|---|---|---|
| 1 | `board/model/index.ts` | `BoardMeta`: add `context?`, `contextDerivedAt?`, `contextDeriveSeq?` (all optional — additive, no migration) |
| 2 | `board/persist/local/board-registry.ts` | `setBoardContext(id, context, { derivedAt, deriveSeq })` — reuse the `renameBoard` put idiom |
| 3 | `agent/types/chat.ts` | `LocalChat`: add `context?`, `contextTurnAt?`, `contextTokenAt?` |
| 4 | `agent/store/chat-repo.ts` | **carry the new fields through `saveTranscript`** (it rebuilds the `LocalChat` from a fixed field list, so unlisted fields are dropped — must copy from `prev`); add `setChatContext(chatUid, context, { turnAt, tokenAt })` |
| 5 | `agent/local/board-drift.ts` (new, pure) | `boardDriftSince(recentOps)` → `{ charsChanged, nodesTouched }` + `shouldDerivePurpose(meta, drift, now)` — pure, fixture-tested |
| 6 | `agent/local/describe-board.ts` | extend: `deriveBoardPurpose(boardId, store, rootId, llm)` beside the existing title pass — gate on drift, call the model over current state, persist + stamp |
| 7 | `agent/local/conversation-context.ts` (new) | `maybeRefreshConversationContext(chatUid, messages, llm)` — gate on turns/token growth, fold recent turns into the rolling `LocalChat.context`, persist + stamp |
| 8 | `agent/prompts/*` | small prompt for each derive (purpose, thread-summary); or extend `describe-board.md` |
| 9 | `agent/local/use-local-submit-prompt.ts` | turn-end: fire-and-forget both derives beside `maybeAutoLabelBoard`; **inject** board purpose (a line in/above `## BOARD`) and `## CONVERSATION` into the system seam; track whether the board/purpose was used this turn to gate the purpose derive |

Downstream (rendering, the chat UI) is untouched — both are prompt-only.

## Injection

- **Board purpose** → a short lead line in the `## BOARD` section (or just above it): "Purpose: …".
- **Conversation context** → a `## CONVERSATION` section (the rolling summary). In Phase 4 it sits
  alongside the full history (mild redundancy); Phase 6 turns it into the compaction checkpoint so the
  history it summarizes can be spliced out.

Both are model-derived text → **fenced as data** like `## MEMORY` (a saved summary could carry
injected instructions).

## Tests

- **`board-drift.test.ts`** (pure, fixtures): `charsChanged` from add/update ops; `nodesTouched`
  counts distinct nodes incl. removes; `shouldDerivePurpose` true when never-derived / over chars /
  over nodes / stale-by-time, false otherwise; agent-written ops don't re-trip (baseline = post-turn seq).
- **`chat-repo` test**: `saveTranscript` **preserves** `context`/`contextTurnAt`/`contextTokenAt`
  across a save (regression guard for the rebuild-drops-fields gotcha); `setChatContext` round-trips.
- **`board-registry` test**: `setBoardContext` persists + stamps; leaves other fields intact.
- **`conversation-context.test.ts`**: gate fires on turn-count and on token-growth; a failed/again
  call leaves the last-good `context`; rolling fold passes prior summary + recent turns to the llm.
- **`describe-board` test**: `deriveBoardPurpose` gated (no drift → no call), persists + stamps on success,
  leaves purpose untouched on model failure.

## Estimate

~400–550 impl LoC + ~200 test (per the roadmap). Complexity **Med** — schema changes are
additive/simple; the care is in the **gates** (drift fingerprint, turn/token thresholds), the
**saveTranscript field-carry gotcha**, and the derive prompts.

## Sequencing

Depends on Phase 3 only for the repo/persistence idiom (no code dep). Phase 6 (compaction) consumes
`LocalChat.context`; Phase 5 (history fidelity) is independent and adjacent to Phase 2.
