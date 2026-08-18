# Claude Code: the memory/context compression prompt

Focused companion to `inspiration-claude-code-memory.md`. Answers one question precisely:
**what prompt does Claude Code use to compress context, what goes in, what comes out, and
does it use any tools?** All citations are `path:line` in `~/workspace/leak-claude-code/`.

## First: "compress memory" is three different things

There are three compression-adjacent mechanisms, and the **tool answer differs for each** —
so the disambiguation matters:

| Mechanism | Compresses | Uses tools? |
|---|---|---|
| **Conversation compaction** (the famous one) | the running message history → a text summary | **No** — text-only, tools denied |
| **Session-memory self-condense** | `summary.md` when it exceeds its 12K-token budget | **Yes** — the note-taker `Edit`s the file |
| **Dream prune** | `MEMORY.md` + topic files, nightly | **Yes** — `Read`/`Grep`/`Edit`/`Write` |

This doc details **conversation compaction** (the primary "compression," and the one with
the notable prompt), then summarizes the other two at the end so the tool question is fully
answered.

---

## Conversation compaction

Source: `services/compact/prompt.ts` (the prompts) and `services/compact/compact.ts` (the
input prep + tool config).

### The INPUT (what the summarizer model sees)

The summarizer is a **one-shot model call** whose message list is built at
`compact.ts:1292-1301`:

```
normalizeMessagesForAPI(
  stripImagesFromMessages(
    stripReinjectedAttachments([
      ...getMessagesAfterCompactBoundary(messages),   // the conversation to compress
      summaryRequest,                                  // a user message = getCompactPrompt()
    ]),
  ),
)
```

So the input is:

1. **The conversation since the last compaction boundary** — `getMessagesAfterCompactBoundary`
   (not the whole history; earlier already-compacted spans are excluded).
2. **Two transforms before it's sent:**
   - `stripReinjectedAttachments` — removes previously re-injected file attachments (avoid
     double-paying for file bodies).
   - `stripImagesFromMessages` — strips image blocks (keeps text, tool_use/tool_result, and
     thinking blocks); images can't be summarized and are expensive.
3. **A final user message** carrying the compaction prompt (`summaryRequest`).

**System prompt for the call:** minimal — `"You are a helpful AI assistant tasked with
summarizing conversations."` (`compact.ts:1302-1304`) on the streaming-fallback path. The
preferred path is a **cache-sharing fork** that inherits the parent's full system prompt +
message prefix (so it hits the prompt cache), with the compaction instruction appended.

**Call config** (`compact.ts:1305-1321`): `thinkingConfig: disabled`, `querySource:
'compact'`, `maxOutputTokensOverride = min(COMPACT_MAX_OUTPUT_TOKENS = 20_000, model max)`,
`maxTurns: 1`.

### The PROMPT (verbatim)

Assembled by `getCompactPrompt(customInstructions?)` as **`NO_TOOLS_PREAMBLE` + `BASE_COMPACT_PROMPT`
+ (optional custom instructions) + `NO_TOOLS_TRAILER`** (`prompt.ts:293-303`).

**① No-tools preamble** (`prompt.ts:19-26`) — placed FIRST because on newer adaptive-thinking
models the model sometimes tries a tool call despite the trailer, wasting its only turn:

```
CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.
```

**② The base compaction prompt** (`prompt.ts:61-143`) — the analysis instruction + the
9-section spec + a worked example:

```
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages: 
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]

</summary>
</example>

Please provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response. 

There may be additional summarization instructions provided in the included context. If so, remember to follow these instructions when creating the above summary. Examples of instructions include:
<example>
## Compact Instructions
When summarizing the conversation focus on typescript code changes and also remember the mistakes you made and how you fixed them.
</example>

<example>
# Summary instructions
When you are using compact - please focus on test output and code changes. Include file reads verbatim.
</example>
```

**③ Optional custom instructions** appended as `\n\nAdditional Instructions:\n<text>` — from
`/compact <text>` or a PreCompact hook.

**④ No-tools trailer** (`prompt.ts:269-272`):

```
REMINDER: Do NOT call any tools. Respond with plain text only — an <analysis> block followed by a <summary> block. Tool calls will be rejected and you will fail the task.
```

> **Prompt-design notes worth stealing.** (a) The `<analysis>` block is a **drafting
> scratchpad** — it improves quality, then gets thrown away (see OUTPUT). (b) Section 6 "All
> user messages" and Section 9's demand for **verbatim quotes** of the current task exist to
> prevent "task drift" across the compression boundary. (c) The no-tools framing is doubled
> (preamble + trailer) and explains the *consequence* ("waste your only turn") — behavioral,
> not just a rule.

There are two other variants for **partial** compaction (`prompt.ts:145-267`):
`PARTIAL_COMPACT_PROMPT` (`direction: 'from'` — summarize the recent tail, keep the older
prefix, preserves prompt cache) and `PARTIAL_COMPACT_UP_TO_PROMPT` (`'up_to'` — summarize the
prefix, keep the newer tail; its sections 8–9 become **"Work Completed"** and **"Context for
Continuing Work"** because the summary is prepended before newer messages). Same 9-slot
shape otherwise.

### The OUTPUT

**Raw model output:** `<analysis>…</analysis>` followed by `<summary>1. … 9. …</summary>`.

**Post-processing** — `formatCompactSummary` (`prompt.ts:311-335`):
1. **Strips the `<analysis>` block entirely** (`replace(/<analysis>[\s\S]*?<\/analysis>/, '')`)
   — the scratchpad never reaches context.
2. Replaces the `<summary>…</summary>` tags with a plain `Summary:\n…` header.
3. Collapses extra blank lines.

**Final wrapping** — `getCompactUserSummaryMessage` (`prompt.ts:337-374`) turns it into the
message that actually re-enters the conversation:

```
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<formatted summary>
```

plus, conditionally:
- a transcript pointer: *"If you need specific details from before compaction (like exact
  code snippets, error messages, or content you generated), read the full transcript at:
  <path>"* — **the lossless fallback**: the summary is lossy, but the raw transcript survives
  on disk and the model is told where to read it.
- `"Recent messages are preserved verbatim."` when a recent tail was kept.
- when auto-triggered (`suppressFollowUpQuestions`): *"Continue the conversation from where it
  left off without asking the user any further questions. Resume directly — do not
  acknowledge the summary, do not recap… Pick up the last task as if the break never
  happened."*

This becomes a `UserMessage` flagged `isCompactSummary: true`. The new conversation history
is then assembled in order (`buildPostCompactMessages`): **boundary marker → summary message →
kept recent messages → re-hydrated attachments → hook output**. "Re-hydrated attachments" =
the last ≤5 read files (≤5K each / 50K total), the active plan, invoked-skill text, and
tool/agent/MCP availability — surgically re-injected so the model isn't amnesiac about its
environment after compression.

### Does compaction use any tool? — **No.**

Compaction is a **text-only summarization turn**. Two layers enforce it:

1. **Prompt level:** the no-tools preamble + trailer above.
2. **Runtime level:** on the preferred cache-sharing fork path, `canUseTool` is
   `createCompactCanUseTool()` (`compact.ts:1125-1134`), which **denies every tool call**:

   ```ts
   return async () => ({
     behavior: 'deny',
     message: 'Tool use is not allowed during compaction',
     decisionReason: { type: 'other', reason: 'compaction agent should only produce text summary' },
   })
   ```

   with `maxTurns: 1` — one shot, text only.

   Caveat on the **streaming-fallback path**: its tool *schema* is minimal — `[FileReadTool]`
   (plus `ToolSearchTool` + MCP tools only when tool-search is enabled) — for API/cache
   reasons, but the prompt still forbids tool calls. So the fork path *hard-denies* tools; the
   fallback path *exposes only FileReadTool but instructs against using it*. Net effect:
   **compression produces a summary from context alone, without gathering new information via
   tools.** (Contrast the fork's full inherited tool set, which exists purely for prompt-cache
   key-matching, not for use — `prompt.ts:12-18`.)

---

## The other two "memory compression" mechanisms (tool answers)

### Session-memory self-condense — **uses `Edit`**

When `summary.md` grows past its budget (`MAX_SECTION_LENGTH = 2000` tokens/section,
`MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000` total), the background note-taker is told to shrink
it in place. The instruction (session-memory update prompt): *"if a section is approaching
this limit, condense it by cycling out less important details while preserving the most
critical information"*, and when over total budget: *"You MUST condense the file… Aggressively
shorten oversized sections by removing less important details, merging related items, and
summarizing older entries. Prioritize keeping Current State and Errors & Corrections."* The
note-taker is a **forked subagent restricted to the `Edit` tool on that one file** — so this
compression **does** use a tool. Separately, at compaction time
`truncateSessionMemoryForCompact` does a **hard, non-model** truncation (cut each oversized
section at a line boundary, append `[... section truncated for length ...]`).

### Dream prune — **uses `Read`/`Grep`/`Edit`/`Write`**

The nightly `autoDream` consolidation's Phase 4 ("Prune and index") rewrites `MEMORY.md` to
stay *"under 200 lines AND under ~25KB… an index, not a dump,"* removing stale pointers,
demoting over-long lines, resolving contradictions. This runs as a **forked agent with
read-only Bash + Read/Grep/Edit/Write scoped to the memory dir** — so it **does** use tools.

---

## One-line answers

- **Prompt to compress context:** `NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT (9 sections +
  worked example) + NO_TOOLS_TRAILER` (`services/compact/prompt.ts`).
- **Input:** messages since the last compaction boundary (images + re-injected attachments
  stripped) + the prompt, one shot, thinking disabled, ≤20K output tokens.
- **Output:** `<analysis>` (discarded) + `<summary>` 9 sections → reformatted → wrapped as a
  "This session is being continued…" user message + transcript pointer + resume directive,
  then re-assembled with a boundary marker and re-hydrated file/plan/tool attachments.
- **Tools:** conversation compaction uses **none** (denied at runtime, forbidden in prompt);
  the two *memory-file* compressions (session-memory condense, dream prune) **do** use
  `Edit`/`Write` because they rewrite files.
