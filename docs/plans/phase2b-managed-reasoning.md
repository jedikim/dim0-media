# Phase 2b — managed reasoning (implementation plan)

Forward the provider reasoning channel through the **managed transport** so browser-engine turns on
our keys get the same chain-of-thought that [Phase 2a](./phase2-reasoning.md) already lit up for
BYOK. This doc covers only what 2b adds; the shared model/UI framing and the accumulation semantics
live in [`phase2-reasoning.md`](./phase2-reasoning.md) and are **not** restated here.

## Why this is a separate slice at all

The managed path is **not** a byte relay — it is a *field-selective projection*. Both managed
endpoints in `backend/topix/api/router/ai.py` reconstruct a minimal wire format from the litellm
response and keep only `content` + `tool_calls`:

- `/ai/llm/stream` `generate()` reads `delta.content` and `delta.tool_calls`, then rebuilds a `final`
  message from those two alone.
- `/ai/llm` `_message_to_dict()` is explicit: *"the minimal ChatCompletion message (content +
  tool_calls)"*.

So reasoning is dropped **by omission in the projection**, not by any provider or transport limit.
The data is present server-side — the endpoint just never emits it. That is why 2a (which parses raw
provider chunks in the browser) forwards reasoning today and the managed path does not: same
project-the-stream move, applied in two places, one of which omits the field.

## The one field that matters: `delta.reasoning_content`

Verified against the pinned **litellm 1.83.14** (`types/utils.py`, `class Delta`):

- litellm **normalizes every provider's reasoning into one field, `reasoning_content`** — a provider
  that emits `delta.reasoning` (Cerebras, Groq gpt-oss, OpenRouter) is mapped to `reasoning_content`
  in `Delta.__init__` before the model is built. The server reads **one** field regardless of
  provider (the frontend's `reasoning_content ?? reasoning` dance is a browser-only concern).
- **Gotcha — attribute is deleted when absent.** When a delta has no reasoning, litellm runs
  `del self.reasoning_content` "to match the OpenAI spec." So `delta.reasoning_content` raises
  `AttributeError` on every ordinary token. **Always** read it as
  `getattr(delta, "reasoning_content", None)`, never by attribute access — a naive access crashes the
  stream on the first non-reasoning delta.
- **Do not enable** litellm's `merge_reasoning_content_in_choices`: it folds reasoning into `content`
  wrapped in `<think>` tags, which would pollute the answer body. We keep reasoning on its own line.

## Changes (file by file)

| # | File | Change |
|---|---|---|
| 1 | `backend/topix/api/router/ai.py` (`generate()`) | after the `delta.content` branch: `rc = getattr(delta, "reasoning_content", None); if rc: yield json.dumps({"type": "reasoning", "text": rc}) + "\n"` |
| 2 | `webui/.../engine/managed-client.ts` | add `{ type: "reasoning"; text: string }` to `ManagedStreamLine`; in `completeStream`, `else if (line.type === "reasoning") yield { kind: "reasoning", text: line.text }` |
| — | agent-loop / consumer / `stepsFromEvents` / UI | **none** — everything downstream of `LlmStreamEvent` is transport-agnostic and already done in 2a |

The managed line mirrors 2a's stream event exactly, so it flows into the same accumulation and
rendering path with zero new frontend logic.

## Non-stream path (`/ai/llm`)

`_message_to_dict()` also strips reasoning. The agent loop **prefers streaming** (`completeStream`),
so the non-stream path is only hit as a fallback. Optional, low-value: surface
`getattr(message, "reasoning_content", None)` on the returned message. **Deferred** unless a
non-streaming reasoner turns up in practice — matches the same deferral in 2a.

## Tests

- `backend/test/unit/api/router/test_ai_llm_router.py`: a streamed chunk carrying `reasoning_content`
  emits a `{type:"reasoning"}` NDJSON line; a stream with no reasoning emits **no** reasoning line
  (regression guard for the `getattr` default — proves ordinary deltas don't crash or leak an empty
  line). Use the existing scripted-`litellm.acompletion` fixture in that file.
- `webui/.../engine/managed-client.test.ts`: a `{type:"reasoning"}` line yields
  `{ kind: "reasoning", text }`; existing delta/tool_start/final cases stay green.
- No new frontend accumulation tests — 2a already covers `stepsFromEvents` / agent-loop reasoning.

## Deferred (shared with 2a, see that doc)

Re-feeding reasoning across turns needs the **signed** payload, not the display text. In litellm that
is `Delta.thinking_blocks` / `reasoning_items` (Anthropic thinking signatures), a channel distinct
from `reasoning_content`. 2b stays **display-only**, exactly like 2a; signature-aware re-injection is
the later phase (open question #3 in the architecture doc).

## Estimate

~40 LoC impl (≈4 Python in `generate()`, one `ManagedStreamLine` variant + map) + ~40 test.
Complexity **Low** — the projection insight and the `getattr` gotcha are the only real content, and
both are settled above.

## Sequencing

Stacked on the 2a branch (`feat/agent-reasoning-capture`). Merges after 2a; if 2a merges first,
rebase onto `main`. No overlap with 2a's files except the shared `LlmStreamEvent` contract, which 2a
already defines.
