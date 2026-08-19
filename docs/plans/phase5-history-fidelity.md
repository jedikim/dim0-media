# Phase 5 — history fidelity + tool-output bounding (implementation plan)

Stop unbounded tool output from bloating the agent's context — both **within a turn** (the raw result
fed back to the model each tool round) and **across turns** (the stored traces re-sent as history).
Design rationale in [`agent-context-architecture.md`](./agent-context-architecture.md) Part 4 (items
2-3) / Part 6 Phase 5; not restated here.

## Scope of THIS PR — the low-risk, high-value subset

Part 4 lists three items. Item 1 (reasoning wiring) **already shipped** in Phase 2. This PR takes the
two clearly-correct pieces of items 2-3 and **defers** the risky rework:

**In:**
1. **Intra-run tool-result cap** — bound the raw tool output fed back to the model inside a turn's
   tool loop (`agent-loop.ts`), so one large `fetch`/`web_search`/`doc_search` can't blow up every
   subsequent round of the same turn.
2. **Age tool outputs in cross-turn history** — in `chat-history.ts`, the most-recent turns keep full
   tool output; older turns get a much smaller cap (bulk dropped, ids preserved). Bounds the
   16-message history growth cheapest-first.

**Out (deferred — higher risk, not needed for the value):**
- Rewriting the round-trip to **native** `assistant{toolCalls}` + `tool` messages instead of the
  `<Reasoning>` XML (item 2a). The XML path is already byte-stable and works; switching wire shapes
  risks tool-pairing bugs for marginal gain.
- Replacing the stored UI-shaped `ToolOutput` with a raw `StoredToolOutput.preview`. Today's stored
  output already preserves the load-bearing bits (note ids, structured sources), so this is churn.
- Full compaction (Phase 6).

## The two changes

### 1. Intra-run cap (`agent-loop.ts`)

Today: `messages.push({ role: "tool", content: JSON.stringify(output) })` — **uncapped**. A 200KB
fetch result then rides in context for every remaining round of the turn.

Change: cap the serialized result to `MAX_TOOL_RESULT_CHARS` with a truncation marker that tells the
model how to get more:

```ts
const capResult = (s: string) =>
  s.length > MAX_TOOL_RESULT_CHARS
    ? s.slice(0, MAX_TOOL_RESULT_CHARS) + `\n…[truncated ${s.length - MAX_TOOL_RESULT_CHARS} chars — call the tool again with a narrower query for more]`
    : s
```

Truncating the tail keeps the head (ids, first results, the fields the model usually needs). Small
results (note-tool `{id, created}`, failures) are never touched. Deterministic → byte-stable re-send.

### 2. Age old outputs (`chat-history.ts`)

Today: every turn's tool `<Output>` is capped at a uniform `MAX_COMPACT_TEXT_LENGTH` (10k). Across 16
messages that's a lot of stale output the model rarely needs at full fidelity.

Change: cap by **recency**. The last `RECENT_FULL_TURNS` assistant turns keep the full output cap; older
turns cap at a small `MAX_AGED_OUTPUT_CHARS` (bulk gone, ids survive because they sit at the head of the
JSON). Thread a `keepFullOutput` flag from `toLlmHistory` (which knows each turn's position) down
through `compactMessageContent` → `compactReasoning` → `compactStep` → `compactOutput(output, cap)`.

Inputs (args) are already small and stay full — only outputs age.

## Constants (tune later)

`MAX_TOOL_RESULT_CHARS = 8000` (intra-run), `RECENT_FULL_TURNS = 4`, `MAX_AGED_OUTPUT_CHARS = 500`,
existing `MAX_COMPACT_TEXT_LENGTH = 10_000` (recent-turn output cap) unchanged.

## Tests

- **`agent-loop` test**: a tool returning a huge string is truncated (with the marker) in the `tool`
  message fed to the next round; a small result is passed through untouched; the truncation is
  identical across two runs (byte-stable).
- **`chat-history` test**: an old assistant turn's tool `<Output>` is shortened to the aged cap while
  the most-recent turn keeps full output; a note id at the head survives aging; inputs stay full;
  the existing round-trip tests still pass (backward-compatible).

## Backup compatibility

No `ReasoningStep` schema change — this only changes how stored steps are *rendered* into history, so
the opaque transcript backup (`chat-persist.ts`) is unaffected.

## Estimate

~120-180 impl LoC + ~120 test. Complexity **Med** — the care is byte-stability (deterministic caps)
and threading the recency flag without disturbing the existing round-trip.

## Sequencing

Independent (adjacent to Phase 2, merged). Phase 6 (compaction) layers a token-threshold summarize on
top, reusing the Phase 4 conversation checkpoint.
