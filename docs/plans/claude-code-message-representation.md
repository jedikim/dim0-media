# Claude Code: what the model actually sees in past turns

How Claude Code serializes prior agent turns — reasoning + interleaved tool calls + results —
into the message history it re-sends on every request. Answers: *a turn is a list of steps
(reasoning → tool calls → reasoning…); what does that look like in the payload, and how are
tool inputs/outputs represented and truncated?*

Builds on the existing analyses in the leak's `claude-code-analysis/` (`streaming-events`,
`tools`, `file-related-tools`). Code cites `~/workspace/leak-claude-code/`.

## TL;DR — the mental model

1. **A turn is one assistant message whose `content` is an ordered list of blocks**:
   `thinking` / `text` / `tool_use` — in the exact order the model emitted them. "Reasoning →
   multiple tool calls → reasoning" is just that block list; parallel/interleaved calls are
   several `tool_use` blocks in the same array.
2. **The role boundary splits a step from its result.** `tool_use` blocks ride the **assistant**
   message; the matching `tool_result` blocks ride the **next user** message. So a multi-step
   trajectory is `assistant[…tool_use×N] → user[tool_result×N] → assistant[…] → …`.
3. **The model does NOT see the tool's rich output object.** It sees a **rendered, truncated,
   wrapped string** (`mapToolResultToToolResultBlockParam`), which differs from both the tool's
   internal `Output` object *and* what the human sees in the UI.
4. **Prior thinking is preserved** (with its signature) and re-sent — with four narrow exceptions.
5. Everything runs through `normalizeMessagesForAPI` (`utils/messages.ts:1989`), which
   **re-merges** the turn that streaming split apart, then a fixed chain of integrity/strip passes.

## A worked example — what one turn looks like on the wire

A turn where the model thinks, calls two tools, then (next request) continues:

```jsonc
// assistant message (one message.id, blocks in emission order)
{ "role": "assistant", "content": [
    { "type": "thinking", "thinking": "I need to check the config and run tests.",
      "signature": "…" },                         // ← preserved across turns
    { "type": "text", "text": "Let me check two things." },
    { "type": "tool_use", "id": "toolu_A", "name": "Read",
      "input": { "file_path": "/app/config.ts" } },   // ← full input JSON
    { "type": "tool_use", "id": "toolu_B", "name": "Bash",
      "input": { "command": "npm test" } }
] }
// next user message — results, hoisted to the front, one per tool_use id
{ "role": "user", "content": [
    { "type": "tool_result", "tool_use_id": "toolu_A",
      "content": "     1→export const PORT = 3000\n     2→…" },   // rendered+truncated
    { "type": "tool_result", "tool_use_id": "toolu_B", "is_error": false,
      "content": "<persisted-output>\nOutput too large (412.0KB). Full output saved to: …/toolu_B.txt\n\nPreview (first 2.0KB):\n…\n...\n</persisted-output>" }
] }
```

Note the two tool_results share **one** user message (parallel batch), results come **before**
any text sibling, and the big output is a **preview + disk path**, not the full 412KB.

## 1. Why there's a merge step: streaming splits the turn, normalize rejoins it

During streaming (`services/api/claude.ts`; see your `streaming-events` analysis) each content
block is emitted as a **separate `AssistantMessage` sharing one `message.id`**.
`normalizeMessages` (`utils/messages.ts:741`) then deliberately **splits** any multi-block
message into one-block messages. So mid-pipeline a turn is N fragments.

`normalizeMessagesForAPI` (`:1989`) **re-merges** them: for each assistant fragment it walks
*backwards* and, on finding an assistant with the same `message.id`, concatenates content
(`mergeAssistantMessages`, `:2389` — pure `[...a.content, ...b.content]`):

```
2250  for (let i = result.length - 1; i >= 0; i--) {
        if (msg.type === 'assistant' && msg.message.id === normalizedMessage.message.id) {
          result[i] = mergeAssistantMessages(msg, normalizedMessage); return }
        // skip different-id assistants (teammate streams) and interleaved tool_result users
      }
```

Because streaming order is preserved, `[thinking, text, tool_use, tool_use]` is reconstructed
intact — **this is what makes interleaved reasoning-between-tool-calls faithful.** The backward
walk steps *over* the interleaved `tool_result` user messages and different-id fragments so the
right id's blocks reunite.

The tail of `normalizeMessagesForAPI` is a fixed pass sequence (`:2295-2369`): relocate tool-ref
siblings → filter orphaned thinking-only → strip trailing thinking from the last assistant →
drop whitespace-only assistants → ensure non-empty content → merge adjacent user messages →
sanitize error tool_results → append snip tags → validate images. Then in `claude.ts`:
`ensureToolResultPairing` (`:1301`), strip advisor blocks, and drop media beyond
`API_MAX_MEDIA_PER_REQUEST` (100, oldest-first).

## 2. Tool INPUTS in history — full JSON, minus injected fields

A `tool_use.input` is re-sent as the **full JSON object** — not truncated — but passed through
`normalizeToolInputForAPI(tool, input)` (`utils/api.ts:685`) which strips *synthetic* fields the
runtime injected but the API schema doesn't want:

- **ExitPlanMode**: strips `plan` / `planFilePath`.
- **FileEdit**: strips synthetic `old_string`/`new_string`/`replace_all` from *old resumed
  transcripts* — *"so old --resume'd transcripts don't send whole-file copies to the API."*
- When tool-search is off, the block is rebuilt with only `{type,id,name,input}`, dropping a
  stored `caller` field; tool name is canonicalized to the registered tool's name.

So: inputs are faithful and complete; only runtime-injected metadata is removed.

## 3. Tool OUTPUTS in history — the crux (four size mechanisms)

The model never sees the tool's structured `Output` object (the `{stdout, structuredPatch,
gitDiff, originalFile, …}` shapes in your `file-related-tools` analysis). It sees a string built
by **`mapToolResultToToolResultBlockParam(Output)`** (`Tool.ts:557`) — the *model-facing*
serialization, explicitly distinct from `renderToolResultMessage` (the UI's React render,
`Tool.ts:566`). Four independent size mechanisms apply, in order:

**(a) Per-tool self-truncation** (before it's even a result).
- **Bash** truncates to `getMaxOutputLength()` — default **30,000** chars, env-overridable to
  **150,000** (`shell/outputLimits.ts:3-4`). Marker: `\n\n... [N lines truncated] ...`
  (`BashTool/utils.ts:158`).
- **FileRead** caps at `MAX_LINES_TO_READ = 2000` (`FileReadTool/prompt.ts:10`).

**(b) Result construction** — `mapToolResultToToolResultBlockParam`. Bash joins
`stdout+stderr+backgroundInfo`, sets `is_error: interrupted`, trims blanks. FileRead prepends a
freshness line, adds line numbers, and appends a `CYBER_RISK_MITIGATION_REMINDER` system-reminder
— all **model-only** chrome the UI never shows.

**(c) Large output → persist to disk, leave a preview + path** (the big one).
Threshold = `min(tool.maxResultSizeChars, DEFAULT_MAX_RESULT_SIZE_CHARS)` where
`DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000` (`constants/toolLimits.ts:13`). Over threshold →
`persistToolResult` writes the full content to
`<projectDir>/<sessionId>/tool-results/<tool_use_id>.{txt|json}`, and the model-visible content
becomes (`toolResultStorage.ts:189`):

```
<persisted-output>
Output too large (412.0KB). Full output saved to: /…/toolu_B.txt

Preview (first 2.0KB):
<first 2000 bytes, cut at a newline>
...
</persisted-output>
```

`PREVIEW_SIZE_BYTES = 2000`. **FileRead opts out** (`maxResultSizeChars: Infinity`) — persisting
a file it would just Read back is circular. Images and already-compacted content also skip it.

**(d) Per-message aggregate budget.** The **sum** of tool_result sizes in one wire user message
(a parallel batch) is capped at `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000`
(`toolLimits.ts:49`); the largest fresh results are persisted-to-disk until under budget.
Decisions are **frozen per `tool_use_id`** so re-sends stay byte-identical (prompt-cache safety).

**Empty output** becomes `(<toolName> completed with no output)` (`toolResultStorage.ts:293`) —
because an empty tool_result at the prompt tail makes some models emit a stop sequence and end
the turn.

## 4. Thinking / reasoning across turns

**Prior-turn thinking blocks are preserved and re-sent, with their `signature`, by default.**
There is no general "strip thinking from history" pass. Removal happens in exactly four cases:

1. **Trailing thinking on the *last* assistant only** — the API forbids an assistant message
   ending in thinking, so trailing thinking blocks are sliced (`filterTrailingThinkingFromLastAssistant`,
   `:4781`); an all-thinking message becomes `[{type:'text', text:'[No message content]'}]`.
2. **Orphaned thinking-only fragments** — dropped only if no same-`message.id` sibling has
   non-thinking content (else the merge in §1 rejoins them).
3. **Credential change** (`/login`) — `stripSignatureBlocks` (`:5066`) removes all
   thinking/redacted_thinking because *"their signatures are bound to the API key that generated
   them; after a credential change they're invalid and the API rejects them with a 400."*
4. **Compaction** slicing (which case 2 repairs).

The `signature` rides verbatim inside the thinking block and is never stripped on the normal
path. Token estimation counts only `block.thinking` text, "not the JSON wrapper or signature."
Interleaved thinking (before/between tool calls in one turn) is preserved precisely because the
merge concatenates same-id blocks in emission order (§1).

## 5. Pairing & integrity rules (why trajectories stay valid)

`ensureToolResultPairing` (`:5133`, run after normalize) enforces the API's tool-trajectory
contract:

- **Every `tool_use` needs a `tool_result`.** Missing → a synthetic error block
  `[Tool result missing due to internal error]` (`is_error:true`) is inserted.
- **Orphaned `tool_result`s** (no matching `tool_use`, e.g. resume mid-turn) are stripped.
- **Dedup by id** — duplicate `tool_use` ids in a later assistant, and duplicate `tool_result`s
  for one id, are removed ("tool_use ids must be unique").
- **Ordering/role** — tool_results ride user messages and are **hoisted to the front**
  (`hoistToolResults`, `:2470`) so they precede text ("tool result must follow tool use");
  parallel results merge into one user message.
- **Empty-content placeholders** keep role alternation valid: `[Tool use interrupted]`,
  `(no content)` (`NO_CONTENT_MESSAGE`).

## 6. How past tool outputs get trimmed *later* (microcompaction)

Independent of compaction, old tool *outputs* are cleared in place as the session ages
(`services/compact/microCompact.ts`). Only `COMPACTABLE_TOOLS` (Read/shell/Grep/Glob/WebSearch/
WebFetch/Edit/Write). **Time-based**: when the gap since the last assistant exceeds a threshold
(server cache already cold), keep the last N compactable results, **replace the rest's content**
with `[Old tool result content cleared]`. **Cached** (API cache-editing): deletes old results
server-side without mutating local content, preserving the cached prefix. So a past tool_result's
content evolves: full → preview+path → `[Old tool result content cleared]`, while its
`tool_use`/`tool_result` skeleton stays.

## 7. Model-sees ≠ UI-shows (and ≠ the tool's Output object) — the divergences

- **Two render paths**: model = `mapToolResultToToolResultBlockParam` (string, with
  system-reminders + persisted-output wrappers); UI = `renderToolResultMessage` (React, from the
  raw `Output`). Explicitly documented as diverging (`Tool.ts:582-588`).
- **Persisted large outputs**: model gets the `<persisted-output>` preview; UI shows full stdout.
- **Injected chrome**: FileRead's `CYBER_RISK_MITIGATION_REMINDER` + freshness/line-numbers,
  `(no output)` placeholders, `[id:xxx]` snip tags, and `Tool loaded.` turn-boundary text are all
  **model-only**.
- **"Don't tell the user" meta notes** (`isMeta:true`) — truncation/file-modified notes only the
  model sees.
- **Role reassignment**: local-command output is re-injected as a *user* message so the model can
  reference it.

## Constants quick-reference

| Constant | Value | Location |
|---|---|---|
| `DEFAULT_MAX_RESULT_SIZE_CHARS` | `50_000` | constants/toolLimits.ts:13 |
| `MAX_TOOL_RESULT_TOKENS` / `_BYTES` | `100_000` / `400_000` | toolLimits.ts:22,33 |
| `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS` | `200_000` | toolLimits.ts:49 |
| `PREVIEW_SIZE_BYTES` | `2000` | toolResultStorage.ts:109 |
| `PERSISTED_OUTPUT_TAG` | `<persisted-output>` | toolResultStorage.ts:30 |
| cleared-result marker | `[Old tool result content cleared]` | microCompact.ts:36 |
| Bash output cap (default/max) | `30_000` / `150_000` | shell/outputLimits.ts:3-4 |
| Bash truncation marker | `\n\n... [N lines truncated] ...` | BashTool/utils.ts:158 |
| `MAX_LINES_TO_READ` (FileRead) | `2000` | FileReadTool/prompt.ts:10 |
| missing-result placeholder | `[Tool result missing due to internal error]` | messages.ts:246 |
| empty-result placeholder | `(<toolName> completed with no output)` | toolResultStorage.ts:293 |
| API media cap / request | `100` (oldest dropped) | claude.ts:1312 |

## Implications for the Dim0 board agent

The board agent runs its own browser tool-loop (`features/agent/engine/`), so it faces the same
questions. What to copy:

1. **Persist the turn as an ordered block list** (thinking/text/tool_use), with tool_use on the
   assistant turn and tool_result on the next user turn — don't flatten steps into prose. This is
   what lets the model reason over its own prior trajectory.
2. **Render tool outputs for the model separately from the UI**, and **cap + preview large
   outputs** rather than dumping them — for a canvas agent the analogues are big search results,
   fetched pages, code-run output, doc chunks. A `[too large — N items, showing first K]` preview
   with a way to re-fetch beats flooding context.
3. **Keep tool_use/tool_result pairing strict** — every emitted call needs a result (synthesize
   an error result if a tool fails) or the provider will reject the trajectory. (We already have
   the `ToolFailure` contract per ADR-AGENT-002 — this is the same discipline at the history
   level.)
4. **Byte-stable re-sends** — freeze truncation/preview decisions per tool-call id so replays
   don't churn (matters for any prompt caching we use via the `/ai/llm` proxy).
5. **Trim old tool outputs as the session ages** (the microcompaction pattern) before doing a
   full transcript compaction — cheapest-first, same as the compaction ladder we documented.
