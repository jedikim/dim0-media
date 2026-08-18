# Dim0 agent context & message-representation — current-state review

A code review of the Dim0 browser agent (`webui/src/features/agent/`) for the two tasks we
scoped, grounded in the memory/context research (`inspiration-*`, `synthesis-agent-memory.md`).
For each task: **what exists today → the gaps → the seams to build on.** This is diagnostic; the
implementation plan is the next step.

## Scope model (the vocabulary these tasks assume)

Three nested scopes (from the earlier discussion), plus the cross-cutting memory:

- **Board** = the workspace / "project" scope — spans all conversations on the board. In Dim0 the
  board is effectively the *largest* scope for a local/anonymous user (no account = no true
  cross-board global).
- **Conversation** (a chat thread on a board) = the "session" — holds one transcript, resumable.
- **Turn** = one user message → the agent's multi-step reasoning+tool response.
- **Global memory** = user/account scope, cutting across boards (needs an account; device-local
  for anonymous).

The two tasks map onto this cleanly:
- **Task 1** = introduce **board context** (board scope) + **conversation context** (conversation
  scope) + **global memory** (user scope), and the mechanisms that keep them updated.
- **Task 2** = fix how a **turn** is represented in history (the chain-of-thought the model
  re-reads, and what the user sees).

---

# Task 1 — Board context, conversation context, global memory

## Current state

The agent is invoked from `local/use-local-submit-prompt.ts`, which builds the message array
`[system, ...history, {user}]` (`agent-loop.ts:155-158`). Of the three, only pieces exist:

- **`system`** = `planSystemPrompt(now)` (`use-local-submit-prompt.ts:171`) — the *static*
  `plan-system.md` (role/format/tools guide), with **only `{{time}}` interpolated**. The one
  runtime augmentation is `systemWithDocs` (`:200-202`), which appends a doc-grounding note when
  the board has indexed document chunks. **No board title, node inventory, purpose, or
  conversation context is injected — ever.**
- **`history`** = `toLlmHistory(messages, 16)` — last 16 user/assistant turns (see Task 2).
- **`userMessage`** = `wrapWithMessageContext(prompt, messageContext)` — a `<MessageContext>`
  envelope carrying the *selected notes / active surface* text (cap 12K chars), only when the user
  has something selected.

So the agent's *only* board awareness is: (a) the optional per-turn selection envelope, and
(b) **pull-only** tool access to the live scene (`ctx.store`, `ctx.search`). There is **no tool
that inventories the board** — it can `search_notes` or `get_note(id)` but cannot enumerate,
count, or see the board's shape/title. It genuinely does not know what board it's on.

What's latent and reusable:
- **`DescribeBoard`** (`local/describe-board.ts`) already runs a background LLM pass that derives a
  board **title** from the first conversation and writes it to `BoardMeta.title`. This is the exact
  pattern (background derive → persist → inject) that board/conversation context need — it just
  produces one field today. Its prompt even frames a board as *"a project or workspace label,
  broader than a single conversation"* — our scope split, already articulated.

Storage homes (both currently thin):
- **`BoardMeta`** (`board/model/index.ts:154`) = `{id, title, kind, …}` — **only `title`** is
  descriptive; no `description`/`topic`/`summary`/`context`. (Caveat: for *synced* boards
  `BoardMeta` is server-authoritative and not CRDT-synced — a synced board-context field needs its
  own sync story or stays local.)
- **`LocalChat`** (`types/chat.ts:51`) = `{id, boardId, label?, createdAt, updatedAt, deletedAt?}`
  — **only `label`**; no summary/context/metadata blob.
- **Global memory** — **nothing exists.** No store, no scope, no retrieval.

## The gaps

1. **No board context.** The agent can't see the board's purpose, size, structure, or title
   without spending tool calls, and can't enumerate it at all.
2. **No conversation context.** Cross-turn continuity relies entirely on replaying raw history
   (16-turn window); there's no rolling summary/state of the thread.
3. **No global/user memory.** No durable cross-board facts (preferences, who the user is).
4. **No update mechanism** for any of the above beyond the one-shot title labeler.

## The three new pieces + their update mechanisms

Mapping to the research (`synthesis-agent-memory.md`): board context ≈ project/workspace context
(CC's CLAUDE.md + workspace snapshot; Hermes' `MEMORY.md`), conversation context ≈ session memory
(Hermes' `summary.md`), global memory ≈ user memory (USER.md / mem0 `user_id`).

| Piece | Scope | What it holds | Update mechanism | Storage home |
|---|---|---|---|---|
| **Board context** | board | purpose of the board + a curated/live overview of its structure & key content | (a) **derive** via a DescribeBoard-style background pass; (b) **user-editable**; (c) a **live snapshot** part regenerated per session (node inventory/counts/layer) | new `context`/`description` on `BoardMeta` + a computed snapshot |
| **Conversation context** | conversation | rolling "what this thread is doing / decided / current state" | incremental/background summary (session-memory style), refreshed every N turns | new `context` field on `LocalChat` |
| **Global memory** | user | durable cross-board facts (preferences, role, corrections) | additive extraction + explicit `save`/`update` tool (mem0-style, per the memory design doc) | **new memory store** (front-end-first, per `agent-context-memory.md`) |

Note the board-context split (per the harnesses): a **static** part (purpose + curated overview,
stable across the session, cache-friendly) and a **live snapshot** part (current node
inventory/selection/layer — "point-in-time, re-check before acting"). The snapshot is nearly free
and also fills the "can't enumerate the board" gap.

## The seams (where each slots in)

- **Injection (all three):** the `systemWithDocs` append in `use-local-submit-prompt.ts:200-202`
  is the proven pattern — assemble board context + conversation context (+ retrieved global memory)
  there and append to the system string. Cleaner still: add `{{boardContext}}` /
  `{{conversationContext}}` placeholders to `plan-system.md` via `renderPrompt`
  (`prompts/index.ts`) under a new `## BOARD` / `## CONVERSATION` section. Keep these in the
  *system* message (not the per-turn `<MessageContext>` envelope) so they aren't re-replayed into
  history compaction.
- **Board context derive/persist:** extend `describe-board.ts`'s background pass to also emit a
  board context/summary; persist on `BoardMeta` via `BoardRegistry` (`board-registry.ts`), fetched
  at submit time with the `getLocalStores().boards.getBoard(boardId)` call the labeler already
  makes.
- **Board snapshot (live):** a small pure function over `ctx.store` (node counts by type, titles,
  selection, `rootId`), assembled at submit time — no persistence. Also worth exposing as a
  `get_board_overview` tool for the pull path.
- **Conversation context:** new `context` field on `LocalChat` (`types/chat.ts:51`) →
  `ChatRepo.saveTranscript` (`chat-repo.ts:54-76`) → loaded via `useLocalMessagesStore`; refreshed
  by a background summary pass (analogous to DescribeBoard, but per-chat and recurring).
- **Global memory:** the new store from `agent-context-memory.md` (front-end-first via the
  `StorageEngine` port, a `MemoryRepo` beside `ChatRepo`/`DocRepo`), retrieved per-turn and
  injected at the same system-assembly seam.

---

# Task 2 — Chain-of-thought / turn representation

## The core finding: two fidelity levels

There are **two different representations of a turn**, and the gap between them is the whole task:

- **Intra-turn (inside one `runAgent`)** — *high fidelity, verbatim.* The live `LlmMessage[]`
  carries wire-native structure: `{role:"assistant", toolCalls}` then
  `{role:"tool", content: JSON.stringify(output)}` with the **full, untruncated** tool output
  (`agent-loop.ts:195-206`). `get_note`/`fetch`/`web_search` return uncapped
  (`tools.ts:321`, `fetch-url.ts`, only `search_notes` snippet is capped at 600 chars). This is the
  real chain-of-thought the model reads *during* a run — and it can grow unbounded.
- **Inter-turn (next user message)** — *lossy re-projection.* `toLlmHistory`
  (`chat-history.ts:101-106`) drops the `role:"tool"` messages and `assistant.toolCalls` entirely
  and re-encodes the trace as **XML text inside the assistant's `content`** — `<Reasoning>` with
  `<ToolCall name><Input><Output></ToolCall>` (`compactReasoning`, `:79`). Worse, `<Output>` is
  `JSON.stringify` of the already-lossy UI projection (`ToolOutput`), not the verbatim result — a
  note write stores only `{noteId, label, noteType}` (`agent-event-to-step.ts:53-71`), so
  **next turn the model cannot re-read the note body it wrote, the page it fetched, or its full
  search results.** Truncation is a blunt 10K `slice + "..."` (can corrupt mid-JSON), window is 16
  messages.

So mid-run the model has rich structured context; on the *next* turn it re-reads a weak XML
summary. Task 2 is closing that gap.

## The stored model (what backs both the UI and the round-trip)

`ChatMessage.properties.reasoning.reasoning: ReasoningStep[]` (`types/chat.ts`, `types/stream.ts`)
— an **ordered** step list: `ToolCallStep` (name + args + a *projected* `output` + `state`) and
`ReasoningTextStep` (`message` = answer text, `reasoning`/`thought` = a "thought" slot).
`AgentEvent`s are accumulated into this via `stepsFromEvents` (`agent-event-to-step.ts:112-163`),
preserving order. The whole `ChatMessage[]` (incl. steps) is what's persisted and also PUT
verbatim as the **opaque transcript backup** (`api/chat-transcript.ts`) on synced boards.

**Good news:** the ordered-step structure already exists and is faithful to intra-turn order — the
scaffolding for a proper CoT is there.

## The gaps

**Model-facing (what it re-reads next turn):**
1. **The browser engine doesn't capture reasoning** (but the model + UI already exist — see note).
   `stream-assemble.ts`/`managed-client.ts`/`byok-client.ts` parse only `content` + `tool_calls`
   and **drop the provider reasoning channel** (Claude thinking, o-series/OpenRouter
   `reasoning_content`). `LlmMessage`/`AgentEvent`/`LlmStreamEvent` have no reasoning slot, so
   `runAgent`'s `ReasoningTextStep.reasoning` / `ToolCallStep.thought` are always `""`.
   > **Correction / not-from-scratch:** the reasoning *model, normalization, and UI are already
   > built* — from the legacy/backend runtime. `ReasoningTextStep { reasoning, message, isSynthesis }`
   > (`types/stream.ts:61`), the two-channel `stream_reasoning_message` split (`build.ts:276`:
   > `reasoningBuf` vs `messageBuf`), the `<|F…|>` marker parser (`utils/stream/text.ts`), and
   > `normalizeReasoningSteps` + `reasoning-step-row.tsx`/`tool-step-row.tsx` all exist and are
   > populated **for backend turns** (`api/send-message.ts`, `api/list-messages.ts`). The browser
   > engine reuses the same model + UI but never feeds them. So the work is **wiring the browser
   > engine's provider reasoning into the existing `reasoning` slot**, not building reasoning
   > capture.
2. **Inter-turn history is lossy** — full tool outputs are never stored on the step, so the model
   loses access to what tools actually returned (§ two fidelity levels).
3. **History flattens wire structure into XML** in one `content` string instead of native
   `assistant(toolCalls)` + `tool` messages — forfeits provider-native tool linkage and any
   provider-side reasoning/prompt caching across turns.
4. **Truncation is blunt** (10K `slice`) and the window (16 msgs) drops older context wholesale;
   no smart preview/summarization.
5. **Intra-run tool output is uncapped** → unbounded context growth in long multi-step turns
   (`agent-loop.ts:206`).

**User-facing (what they see):**
6. **No visible chain of thought.** The reasoning/thought UI already exists —
   `ReasoningStepRow`'s "Reasoning" expander, `ToolStepRow`'s "Thought" block
   (`reasoning-step-row.tsx`, `tool-step-row.tsx`) — but is **dead for local turns** because the
   slots are never filled.
7. **Tool results render minimally** — args + a one-line status + ids; note cards show a link but
   **no content preview**; raw output only for code-interpreter/web sources.

## The seams

- **Capture reasoning:** add a `reasoning` channel through `stream-assemble.ts` (parse
  `delta.reasoning`/`reasoning_content`) → a new `LlmStreamEvent`/`AgentEvent` reasoning variant →
  fill `ReasoningStep.reasoning`/`thought`. Lights up the *existing* UI expanders immediately
  (gap 6) and lets reasoning be re-fed (gap 1). Mind the CC lesson: thinking blocks carry
  provider **signatures** and have re-send constraints — decide per provider whether to re-feed or
  display-only.
- **Structured round-trip:** change `toLlmHistory` (`chat-history.ts`) to emit native
  `assistant{toolCalls}` + `tool` messages instead of `<Reasoning>` XML — or, keep XML but stop
  discarding fidelity. Store enough of the real tool output on the step (not just ids) to re-feed,
  with a **preview + truncation** discipline borrowed from Claude Code (see
  `claude-code-message-representation.md`): render tool output for the model separately, cap large
  outputs to a preview + a "N more / re-fetch" affordance, freeze truncation per call id for
  byte-stable re-sends.
- **Cap intra-run output + age it:** apply per-tool output caps (esp. `fetch`/`web_search`/
  `get_note`), and add a microcompaction-style trim of old tool outputs before any full history
  compaction (the "cheapest-first" ladder).
- **Backup compatibility:** any step-schema change must stay backward-compatible on load
  (`chat-persist.ts:20-27` already normalizes old steps) since the opaque transcript backup carries
  this shape verbatim.

---

# How the two tasks relate

- **Shared seam:** both inject at the system-assembly point in `use-local-submit-prompt.ts`
  (`systemWithDocs` pattern). Task 1 adds standing context there; Task 2 changes how `history`
  (also assembled there) is built.
- **Shared model:** conversation context (Task 1) and the transcript representation (Task 2) both
  live on the conversation — conversation context is the *summary* of the thread; Task 2 is the
  *fidelity* of the thread's turns. They're complementary: better per-turn representation reduces
  how much conversation context has to compensate, and vice-versa.
- **Shared discipline (from the research):** fence recalled/injected content, keep the system
  prefix cache-stable (standing context in `system`, per-turn recall separate), and represent a
  turn as an ordered reasoning+tool step list — all apply to both.

# Suggested sequencing (for the plan doc)

1. **Board snapshot (live)** — pure function over `ctx.store`, injected at the system seam. Pure
   win, no persistence, fixes the "can't enumerate the board" gap immediately. (Task 1)
2. **Reasoning capture** — parse the provider reasoning channel; lights up existing UI + enables
   re-feed. High visible value, contained blast radius. (Task 2)
3. **Board context + conversation context fields** + the DescribeBoard-style derive passes. (Task 1)
4. **Structured/higher-fidelity history round-trip** + tool-output preview/caps. (Task 2)
5. **Global memory store** — per `agent-context-memory.md`. (Task 1)

Each step is independently shippable and independently valuable.
