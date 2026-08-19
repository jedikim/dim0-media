# Phase 6 — conversation compaction (implementation plan)

Keep the assembled prompt bounded on long threads by **compacting history at turn start** when it nears
a token budget: drop the transcript down to a verbatim recent tail and lean on the always-injected
`## CONVERSATION` summary (Phase 4) to carry the earlier gist. Reuses `LocalChat.context` as the
summary — no extra LLM call when it's fresh; one blocking summarize only for a never-summarized thread.
Design rationale in [`agent-context-architecture.md`](./agent-context-architecture.md) Part 3
(Compaction) / Part 6 Phase 6; not restated here.

## What compaction actually means HERE (grounded in the current code)

Two facts from the shipped code reshape the textbook design:

1. **`toLlmHistory` already caps history to the last `MAX_HISTORY_MESSAGES` (16) messages** and ages
   old tool output (Phase 5). Turns older than 16 messages are *already dropped* — not summarized.
2. **The rolling summary is already injected every turn** as a fenced `## CONVERSATION` block
   (`buildConversationBlock`, Phase 4), refreshed at turn end when the thread grows.

So the classic "splice = summary + recent tail" is *half done*: the summary is present in the system
prompt already. Compaction's remaining job is to **trim the history window to a shorter recent tail
when the prompt is over budget**, ensuring the summary that now covers the trimmed turns is actually
present (blocking-summarize once if it isn't). It is NOT a new place to store a summary.

## The mechanism

At turn start, after assembling the system prompt sections and `history = toLlmHistory(messages)`:

1. **Estimate** prompt tokens: `estimateTokens(system) + Σ estimateTokens(history[i].content) +
   estimateTokens(userMessage)` (reuse `estimateTokens` = chars/4 from `conversation-context.ts`).
2. **Gate:** if `tokens < COMPACT_PCT × COMPACT_TOKEN_BUDGET` → no compaction, proceed as today.
3. **Over budget → compact:**
   - **Ensure a summary exists.** If `LocalChat.context` is non-empty (fresh OR stale) → use it as-is
     (cases 1 & 3 of the graceful hierarchy — no LLM; the verbatim tail absorbs slight staleness). If
     it's empty (thread never summarized, case 4) → **one blocking summarize** over the older messages,
     stored into `LocalChat.context` so it's a splice next time.
   - **Trim** `history` to the last `COMPACT_TAIL_MESSAGES` messages (verbatim). The earlier turns are
     covered by the `## CONVERSATION` block.
4. **Anti-thrash:** the blocking summarize is naturally once-per-thread (it caches into `context`).
   And never trim below `COMPACT_TAIL_MESSAGES` — if the recent tail + system alone exceed budget,
   proceed without further trimming (can't compact more without losing recent fidelity).

The mid-flight **bounded-wait** on an in-flight refresh (design case 2) is **deferred**: without it,
case 2 degrades to case 3 (use the last-good `context`), which is already correct — the recent tail is
verbatim. Tracking the refresh promise for a marginal freshness gain isn't worth the shared-state
complexity in v1.

## Ordering (the one wiring subtlety)

`buildConversationBlock` reads `LocalChat.context`. If compaction does a blocking summarize, it must
run **before** the `## CONVERSATION` block is built, so the block reflects the just-written summary.
So the assembly order becomes: resolve compaction (maybe summarize + update context) → build
`## CONVERSATION` from the now-current context → assemble system → trim history.

## Budget — model-agnostic

The client model catalog (`PublicModel`) carries **no context-window size**, and BYOK targets
arbitrary provider models, so a per-model window isn't knowable client-side. Use a tunable constant
`COMPACT_TOKEN_BUDGET = 50_000` at `COMPACT_PCT = 0.8` (compact at ~40k prompt tokens). 50k stays
safely under every supported model's window (modern windows are 200k+) while leaving enough headroom
that recent history isn't trimmed prematurely on moderately long threads — a lower ceiling (~24k) was
too eager, sacrificing conversational fidelity to save tokens the models can easily afford. (If the
catalog later gains a window field, derive the budget from it instead of the constant.)

## Changes (file by file)

| # | File | Change |
|---|---|---|
| 1 | `agent/local/chat-history.ts` | `estimatePromptTokens(system, history, userMessage)`; `compactHistory(history, { summary, tailMessages })` → the trimmed history (pure, no LLM) |
| 2 | `agent/local/conversation-context.ts` | export a forced `summarizeConversation(chatUid, messages, llm)` (the existing fold logic, gate bypassed, awaited) reused for the case-4 blocking summarize |
| 3 | `agent/local/use-local-submit-prompt.ts` | turn-start: estimate → gate → (maybe blocking summarize) → trim history; move the `buildConversationBlock` call after the compaction resolve |
| — | constants | `COMPACT_TOKEN_BUDGET`, `COMPACT_PCT`, `COMPACT_TAIL_MESSAGES` in `chat-history.ts` |

No schema change (reuses `LocalChat.context`); no new store; prompt-only + history-shaping.

## Tests

- **`chat-history` test**: `estimatePromptTokens` sums system + history + user; `compactHistory`
  returns the full history under budget, and the last `COMPACT_TAIL_MESSAGES` when over; a verbatim
  tail is preserved byte-for-byte; never trims below the tail.
- **`conversation-context` test**: `summarizeConversation` runs regardless of the gate and returns the
  model's summary; best-effort on failure.
- **`use-local-submit-prompt`** (light/integration if feasible): over-budget + empty context triggers
  exactly one blocking summarize; a present context triggers none.

## Estimate

~250–350 impl LoC + ~150 test. Complexity **Med** — the token estimate + the assembly-ordering move
are the fiddly bits; the summary reuse (Phase 4) removes most of the work.

## Sequencing

Depends on Phase 4 (`LocalChat.context`, merged) and sits after Phase 5 (aging, merged). Last piece of
the v1 arc; Phase 7 (memory sync + retrieval scaling) is the deferred post-v1 work.
