# Phase 2 — reasoning capture (implementation plan)

Wire the browser engine's **provider reasoning channel** into the reasoning model + UI that already
exist, so the agent's chain-of-thought is visible on browser-engine turns. Grounded in the
post-merge code; the architecture rationale is in
[`agent-context-architecture.md`](./agent-context-architecture.md) §1.5 / §4.1 / Part 6 Phase 2.

## The core framing: wire, don't build

The reasoning *model, normalization, and UI already exist* (from the legacy backend path):

- **Model:** `ReasoningTextStep { reasoning, message, isSynthesis }` (`agent/types/stream.ts`).
- **Accumulator:** `stepsFromEvents` (`agent/local/agent-event-to-step.ts`) already builds
  `reasoning_step`s from `AgentEvent`s — it just leaves `reasoning: ""`.
- **UI:** `reasoning-step-row.tsx` renders a collapsible "Reasoning" section **whenever
  `step.reasoning !== ""`**, and `tool-step-row.tsx` renders `step.thought`. Both are empty for
  browser turns today.

So Phase 2 adds **capture + transport** only. **No new objects, no UI work.** The browser engine's
stream clients currently parse only `delta.content` + `delta.tool_calls` and drop the provider's
reasoning channel entirely (`engine/stream-assemble.ts`, `engine/managed-client.ts`).

## The decisive split: by transport

The two runtimes reach the model over different transports, so reasoning capture differs and can
ship independently:

| Path | Client → assembler | Where reasoning enters | Scope |
|---|---|---|---|
| **BYOK** | `ByokLlmClient.completeStream` → `assembleStreamedTurn` | parse `delta.reasoning_content` / `delta.reasoning` off the raw OpenAI chunk | **frontend-only** |
| **Managed** | `ManagedLlmClient.completeStream` → our `/ai/llm/stream` NDJSON | the **backend `ai.py` proxy** must forward reasoning as a new NDJSON line, then the client parses it | **cross-stack (Python + TS)** |

**Ship 2a (BYOK) first** — self-contained, no backend, lights up reasoning for signed-out / BYOK
users. **2b (Managed)** follows, reusing 2a's frontend event plumbing.

---

## Phase 2a — BYOK reasoning (frontend-only)

### Changes (file by file)

| # | File | Change |
|---|---|---|
| 1 | `agent/engine/types.ts` | add `{ kind: "reasoning"; text: string }` to `LlmStreamEvent`; `{ type: "reasoning"; text: string }` to `AgentEvent` |
| 2 | `agent/engine/stream-assemble.ts` | after the `delta.content` branch, read the reasoning field (see below) and `yield { kind: "reasoning", text }` (per-delta) |
| 3 | `agent/engine/agent-loop.ts` | in the `completeStream` loop, accumulate `reasoningAcc += ev.text` and `yield { type: "reasoning", text: reasoningAcc }` (cumulative, mirroring how `assistant_text` accumulates `acc`) |
| 4 | `agent/local/use-local-submit-prompt.ts` | in the `for await` consumer, coalesce consecutive `reasoning` events in `events[]` (same pattern the `assistant_text` coalescing uses) |
| 5 | `agent/local/agent-event-to-step.ts` | in `stepsFromEvents`, handle `ev.type === "reasoning"`: set the trailing `reasoning_step.reasoning` (create one if the last step isn't a reasoning_step) — parallels the `assistant_text` branch that sets `.message` |
| — | UI | **none** — the expanders already render `.reasoning` |

### Provider reasoning formats (the only real subtlety)

Neither field is in OpenAI's `ChatCompletionChunk` TS type, so read via a narrow cast off `delta`:

- **OpenRouter** → `delta.reasoning` (its unified reasoning field). Some models need `reasoning: {}`
  (or `include_reasoning: true`) in the request body to emit it — a follow-up knob if we want to
  force it on; many reasoning models emit it by default.
- **DeepSeek and other OpenAI-compatible reasoners** → `delta.reasoning_content`.
- Parse **either**: `const r = (delta as { reasoning_content?: string; reasoning?: string }); const text = r.reasoning_content ?? r.reasoning`.

### Accumulation model

Reasoning is a **separate cumulative channel** alongside answer text:

- The loop accumulates reasoning into `reasoningAcc` and answer text into `acc` independently, each
  emitted cumulatively (the existing `assistant_text` pattern).
- `stepsFromEvents` renders a turn as `reasoning_step { reasoning: <thought>, message: <answer> }`.
  Reasoning arriving before the answer fills `.reasoning`; the answer text fills `.message` of the
  same trailing step.
- **Interleaved tool calls** split it naturally: `reasoning → tool_call → reasoning → answer` becomes
  `reasoning_step(pre-tool thought) · tool_step · reasoning_step(post-tool thought + answer)` — the
  chain-of-thought reads top to bottom.

### Tests

- `stream-assemble.test.ts`: a chunk with `reasoning_content` and one with `reasoning` each yield a
  `reasoning` event; a stream with neither is unchanged (**regression guard**).
- `agent-event-to-step.test.ts`: a `reasoning` event fills `reasoning_step.reasoning`;
  reasoning-then-text lands in one step; reasoning-between-two-tools splits into two reasoning steps.
- `agent-loop.stream.test.ts`: the loop emits cumulative `reasoning` events from `reasoning` stream
  events.

### Estimate

~150–200 impl LoC + ~80 test. Complexity **Med** — the provider-format variance is the only tricky
bit; the model and UI are free.

---

## Phase 2b — Managed reasoning (cross-stack, follow-up)

The managed path forwards reasoning through the `ai.py` proxy, reusing all of 2a's frontend
plumbing. Full plan (relay-projection insight, the verified litellm `reasoning_content` field + its
delete-when-absent gotcha, file changes, tests) →
[`phase2b-managed-reasoning.md`](./phase2b-managed-reasoning.md).

---

## Deferred (not in Phase 2)

- **Re-feed reasoning to the model across turns.** Provider reasoning blocks carry **signatures**
  with re-send constraints (Anthropic thinking); re-feeding is a separate decision (open question #3
  in the architecture doc). Phase 2 is **display-only**: reasoning is captured, stored on the step,
  rendered, and backed up in the opaque transcript, but not re-injected into `history`.
- **Non-streaming reasoning.** `complete()` (non-stream) drops reasoning; the loop prefers streaming,
  so this is a minor gap, deferrable.

## Sequencing

1. **2a** (this PR): BYOK reasoning, display-only, frontend-only. Ships visible chain-of-thought for
   BYOK / signed-out.
2. **2b** (follow-up PR): managed path via the `ai.py` proxy.
3. **Later:** re-feed with signature handling (needs a per-provider decision).
