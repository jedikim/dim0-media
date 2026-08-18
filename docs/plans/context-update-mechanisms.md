# Context & memory update mechanisms — trigger model for Dim0

*When* (not what) the agent's context/memory gets built, refreshed, consolidated, and compacted.
Companion to `dim0-agent-context-review.md` (which covers the *what*) and
`synthesis-agent-memory.md`. The thesis: **Dim0 needs no scheduler/cron** — every update hangs off
a natural boundary or point-of-use, gated so the expensive (LLM) work is rare.

## Principle (read this first)

> **Recompute-on-demand for anything free; turn-boundary-gated for anything that costs an LLM call;
> lazy-on-overflow / on-read for cleanup. Nothing runs on a wall clock.**

Work only happens when the user is *active* (turn boundary), goes *idle*, or the data is *actually
needed* (session open / read / window-full). This is strictly cheaper than a cron, needs no
scheduler infrastructure (a real cron in a browser means a service worker or a tab-only
`setInterval` — flaky and wasteful), and matches how the reference systems actually work.

## Premise correction: the reference systems are NOT cron-based

A common misread (we made it too): that Claude Code / Hermes run "nightly" consolidation on a
schedule. They don't. What looks like "nightly" is a **rate-limit gate**, not a scheduler.

| System | Update | Real trigger | Why it's not a cron |
|---|---|---|---|
| **Claude Code** | autoDream (distill memory) | **stop hook at end of every turn**, then gated: skip unless ≥24h *and* ≥5 sessions since last, PID lock | piggybacks on turn-end; 24h is a floor, no daemon |
| CC | extractMemories (write-back) | **end of query loop** (final response), throttled every N turns, stands down if main agent already wrote | turn-boundary hook |
| CC | session memory (rolling notes) | **post-sampling hook** per turn, gated on token-growth + tool-count | turn-boundary hook |
| CC | compaction | **inline** at token threshold | event-driven by necessity |
| **Hermes** | background review (memory + skills) | **post-turn fork**, turn-count nudge (every 10) | turn-boundary hook |
| Hermes | Curator (skill lifecycle) | **idle-triggered** when idle + interval elapsed — *"no cron daemon"* (stated) | opportunistic on idle |
| Hermes | compaction | inline at 50% threshold + 85% gateway safety net | event-driven |
| **mem0** | memory update | **inline, additive, on every `add()`** — one LLM call, deterministic dedup | no separate pass at all |

The invariant across all three: **cheap check at a natural boundary + a gate that makes the
expensive work rare.** Never a wall clock.

## The trigger design space (our menu)

Cheapest → most machinery. The decisive split is **no-LLM work (just recompute)** vs **LLM work
(gate it hard)**.

| # | Option | Fires when | Cost | Fits |
|---|---|---|---|---|
| A | **On-demand compute** | data is needed (session open) | **0 LLM** — read the scene | live board snapshot |
| B | **Inline additive** | during the turn, via a tool the agent calls | folds into the turn (0 extra calls) | global memory writes |
| C | **Turn-boundary hook + gate** | end of turn, if a cheap threshold trips | 1 small-model call, *rarely* | conversation context, extraction |
| D | **Idle-triggered** | user stops interacting for X | deferred, off critical path | heavy consolidation (if ever) |
| E | **Lazy-on-overflow** | a store hits its cap | 0 until full | memory pruning |
| F | **Lazy-on-read** | read + found stale | paid at point of use | board purpose summary |
| G | **Explicit** | user clicks / slash command | 0 automatic | escape hatch — always offer |
| H | **Inline threshold compaction** | context window fills | unavoidable | conversation compression |

We already run this pattern in-tree: **`DescribeBoard`** (`local/describe-board.ts`) fires at
end-of-turn, gated ("only if still untitled"), best-effort — options C/F exactly. We *extend that
precedent*, we don't add a scheduler.

## Recommendation per update target

### 1. Board snapshot (structure / inventory) → **A. On-demand compute. No consolidation.**
A pure function over the canvas store (node counts by type, titles, selection, folder layer),
recomputed each session open (and optionally refreshed within a session on material change).
**Zero LLM, always fresh.** The key realization: the always-fresh part of board context needs *no
pass whatsoever* — it's `gitStatus`, not memory. Also exposable as a `get_board_overview` tool for
the pull path.

### 2. Board purpose / summary → **F + C.**
Derive once via the DescribeBoard pass (already end-of-turn); re-derive **lazily** only when it's
read *and* a cheap deterministic drift check says the board changed materially since (gates the 1
LLM call). Best-effort; never blocks a turn.

### 3. Conversation context (rolling thread state) → **C, fused with H.**
Refresh on a turn-boundary gate (every N turns or on token growth). Critically — the Hermes
insight — **make it the SAME artifact as the compaction summary**: the rolling thread summary you
maintain is exactly what you inject when the window fills. One summary serves both roles, so you
never pay for two. (This also means: if you build conversation context well, compaction is nearly
free — you already have the checkpoint.)

### 4. Global memory (durable user facts) → **B + E.**
Additive writes via an explicit `save_memory`/`update_memory` tool the agent calls during the turn
(no separate pass, no destructive LLM mutation — the mem0 shift we documented). Prune **only on
overflow** (reject-and-consolidate: reject the over-cap write, show current entries, let the model
merge/remove and retry) — never on a schedule. Optional later: a turn-boundary extraction fork
(option C) that stands down if the main agent already wrote (CC's mutual-exclusion).

### 5. Conversation compaction → **H.**
Inline at a token threshold, like everyone. Event-driven and unavoidable. Reuses the conversation
context as the summary (see #3).

## Proposed gate specs (starting points — tune with telemetry)

Concrete cheap checks so "gated" isn't hand-wavy. All numbers are initial guesses to be tuned; the
*shape* matters more than the values.

- **Board snapshot recompute (A):** on session open, always. Within a session, recompute only if
  the scene's node/edge count changed by ≥ `SNAPSHOT_DIRTY_DELTA` (e.g. 3) since last compute —
  otherwise reuse the memoized snapshot (cache-stable, like CC's memoized `getSystemContext`).
- **Board drift check for purpose re-derive (F):** a deterministic, no-LLM signal — e.g.
  `nodesChangedSinceDerive ≥ BOARD_DRIFT_NODES` (e.g. 10) **or** `titleStillDefault` **or**
  `≥ BOARD_DRIFT_DAYS` (e.g. 7) since last derive. Only when this trips *and* the context is being
  read do we spend the LLM call. Store `lastDerivedAt` + a cheap fingerprint (node count / hash)
  on `BoardMeta`.
- **Conversation context refresh (C):** fire the summary pass when, since last refresh, **either**
  `turnsSinceRefresh ≥ CONV_CTX_TURNS` (e.g. 4) **or** `tokenGrowth ≥ CONV_CTX_TOKENS` (e.g. ~4k)
  — mirroring CC session memory's "token threshold is always required, tool-count is secondary."
  Run best-effort in the background after the turn; never block the reply.
- **Compaction trigger (H):** when estimated prompt tokens ≥ `COMPACT_PCT` of the model's effective
  window (start ~0.7, per Hermes/CC ballpark), inline before the next call. Circuit-breaker: skip
  if the last compaction saved < ~10% (CC/Hermes anti-thrash).
- **Memory overflow (E):** reject an `add` that would exceed the store's char/entry cap; return the
  current entries; the model consolidates and retries in the same turn (Hermes pattern). Guard:
  ≤ 3 consolidation retries/turn, then a terminal "answer the user anyway."
- **Small-model routing:** every gated LLM call (board purpose, conversation context) uses the
  *cheap/fast* model via `/ai/llm`, not the main model — matches CC/Hermes routing background
  passes to a small model.

## Cost model (per typical turn under this scheme)

- **Most turns: 0 extra LLM calls.** Board snapshot = recompute (free); global-memory write =
  the agent's own tool call folded into the turn; conversation context not yet due.
- **Every ~N turns: 1 small-model call** for conversation context.
- **Rarely: 1 small-model call** for board purpose (only on drift + read).
- **At genuine boundaries only:** the compaction call (window full).

Contrast a cron: a scheduled pass burns a call (and wakes infra) *whether or not anything changed*.
The gated model burns a call only when something changed enough to matter.

## Where this wires in (seams, from the review)

- All triggers hang off the existing submit path `local/use-local-submit-prompt.ts` (turn start =
  read/inject; turn end = fire gated background work — the DescribeBoard call already lives here at
  `:~284`, `maybeAutoLabelBoard`).
- Board snapshot: pure fn over `ctx.store`, assembled at the system seam (`:200-202`).
- Board purpose + drift fingerprint: `BoardMeta` (`board/model/index.ts`) via `BoardRegistry`.
- Conversation context: `LocalChat.context` (`types/chat.ts`) via `ChatRepo.saveTranscript`.
- Global memory + overflow: the new `MemoryRepo` (`agent-context-memory.md`).
- Compaction: in the loop / history assembly (`chat-history.ts`), reusing conversation context.

## Open questions to settle with the plan

1. Exact gate thresholds (the constants above) — pick starting values, add telemetry, tune.
2. Idle-trigger (option D): do we want it at all for v1, or is turn-boundary + lazy enough? (Lean:
   skip D for v1 — turn-boundary + lazy covers everything without needing an idle timer.)
3. Where "background after the turn" actually runs in the browser — a microtask after the stream
   completes vs a `requestIdleCallback`. (Lean: fire-and-forget after `done`, like DescribeBoard.)
4. Cross-device: for synced boards, does a background-derived board context get backed up (opaque
   blob, per ADR-AGENT-001) or recomputed per device? (Lean: recompute per device for the snapshot;
   back up the derived purpose/summary.)
