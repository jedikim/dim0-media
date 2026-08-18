# Inspiration: how Hermes Agent solves memory & context

A study of the NousResearch **Hermes Agent** source (`~/workspace/hermes-agent/`), written
as a companion to `inspiration-claude-code-memory.md` so the two harnesses can be compared
directly. Same goal: inform our board-agent memory design. File paths cite the Hermes repo;
verify before relying on a detail.

## TL;DR — Hermes vs Claude Code, at a glance

Hermes solves the same problem as Claude Code but with **more explicit structure and more
extension seams**. Where CC has five loosely-coupled subsystems, Hermes has the same shape
plus two big additions: a **pluggable memory-provider layer** and a **self-improvement loop**
(the agent rewrites its own skills). The subsystem map:

| Hermes subsystem | CC analogue | One-line role |
|---|---|---|
| **Built-in memory** — `MEMORY.md` + `USER.md` | memdir | bounded, char-capped, curated facts (agent notes + user profile) |
| **Skill memory + self-improvement** | (no direct CC analogue) | successful workflows → reusable `SKILL.md`; agent edits its own skills |
| **Memory providers** (pluggable) | team memory (barely) | swap in Honcho/Mem0/etc.; external recall as a `<memory-context>` block |
| **Context engine + 3-tier system prompt** | `context.ts` assembly | prompt-cache-stable assembly; swappable engine |
| **Session search** (SQLite FTS5) | transcript grep | unlimited, on-demand recall of the full history |
| **ContextCompressor** | compaction | token-threshold lossy summary of the middle |
| **Curator** | autoDream (dream) | background skill-lifecycle maintenance (stale/archive/pin) |

The two axes from the CC doc still apply — **auto-derived vs curated**, **static vs
per-turn** — and Hermes adds a third theme it takes very seriously: **prompt-cache
stability** as a first-class constraint that shapes *where* everything is injected.

---

## 1. The assembly model: 3-tier system prompt + per-turn user-message sidecar

Hermes' single most pervasive design principle is **keep the cached prefix byte-stable**.
Everything about placement follows from it.

### 1.1 The three-tier system prompt

Built once per session (`agent/system_prompt.py:338`), rebuilt **only on compaction**, joined
as `stable\n\n context\n\n volatile`:

- **`stable`** — identity (`SOUL.md` or `DEFAULT_AGENT_IDENTITY`), tool guidance, environment
  hints, the coding operating brief. Cross-session stable → the cacheable prefix.
- **`context`** — cwd-dependent: caller `system_message`, the **coding workspace snapshot**
  (the gitStatus analogue, §6), and **context files** (`AGENTS.md`/`CLAUDE.md`/`.cursorrules`
  chain).
- **`volatile`** — kept last so a change re-prefills the least: **skills index → `MEMORY.md`
  snapshot → `USER.md` profile → external-memory provider block → date-only timestamp.**

Two cache tricks worth stealing: the timestamp is **date-only** (byte-stable for a full day),
and the skills index is in volatile (not stable) because skills are runtime-mutable.

### 1.2 Per-turn context goes on the USER message, via a sidecar

Anything that changes per turn — external-memory prefetch, plugin context, gateway notes — is
**never** put in the system prompt. It's appended to an `api_content` **sidecar** copy of the
user message (`agent/turn_context.py:54-86`), leaving the stored message clean:

```
api_content = content + "\n\n" + "\n\n".join(injections)
```

The sidecar is persisted so the next turn replays **byte-identically** — "what turn N sends
must be what turn N+1 replays" — which is the whole reason the cached prefix survives. This is
a sharper version of CC's "mechanics in system prompt, content in a fenced user message" split.

**→ For Dim0:** even though we run in the browser (no provider prompt-cache to protect in the
same way), the *discipline* is worth adopting: assemble the static board context once per run;
inject per-turn recall as a separate, clearly-fenced block on the user message, not by mutating
history.

---

## 2. Built-in curated memory: `MEMORY.md` + `USER.md`

The closest analogue to memdir, but **char-capped, split into two stores, and injected as a
frozen snapshot**. Implementation is entirely in `tools/memory_tool.py` (not `hermes_state*`).

### 2.1 Two bounded stores (chars, not tokens)

| Store | Holds | Cap | Path |
|---|---|---|---|
| `MEMORY.md` | agent's notes: env facts, conventions, tool quirks, lessons | **2,200 chars** (~800 tok) | `~/.hermes/memories/MEMORY.md` |
| `USER.md` | user profile: role, style, pet peeves, skill level | **1,375 chars** (~500 tok) | `~/.hermes/memories/USER.md` |

Char caps because they're "model-independent." Entries are delimited by `\n§\n`. The rendered
block even **shows remaining capacity**: `MEMORY (your personal notes) [67% — 1,474/2,200 chars]`.

### 2.2 Overflow is a hard error, not eviction

Unlike CC's 200-line truncation, an `add` past the cap is **rejected**, returning the current
entries so the model can decide what to cut, then retry — ideally as one atomic `batch` that
removes/shortens and adds together. Guards: 3-consolidation-failures-per-turn limit, then a
**terminal** "stop retrying, answer the user" result (a failed memory side-effect must never
block the reply). Dedup on add + on load; `replace`/`remove` match by short unique substring.

### 2.3 Two write paths

- **Foreground tool** (`memory` with `add`/`replace`/`remove`/`operations`). The behavioral
  guidance lives in the tool schema — notably the **WHEN/SKIP** rule:
  > WHEN: "save proactively when the user states a preference, correction, or personal
  > detail… Priority: user preferences & corrections > environment facts > procedures. The
  > best memory stops the user repeating themselves."
  > SKIP: "trivial/obvious info, easily re-discovered facts, raw data dumps, task progress,
  > completed-work logs, temporary TODO state… Reusable procedures belong in a skill, not
  > memory."
- **Passive background review** (§3.2) — a post-turn fork that saves what the model forgot to.

### 2.4 Frozen-snapshot injection + security

Memory is captured **once at session start** and injected as a frozen snapshot; mid-session
writes persist to disk (durable, and tool responses show live state) but **don't change the
system prompt until next session** — again for prefix-cache stability. And content is
**security-scanned on both write and load**: a poisoned-on-disk entry is replaced *in the
injected snapshot* with a `[BLOCKED: … threat pattern …]` marker (live text kept so the user
can remove it). Plus per-file locks, atomic writes, external-drift detection with `.bak`.

**→ For Dim0:** the `MEMORY.md`/`USER.md` **split maps cleanly to our L1 (board memory) / L2
(user/global memory)**. The "show remaining capacity + consolidate-on-overflow" pattern is a
nice alternative to silent truncation and keeps the model honest about the budget.

---

## 3. Skill memory + self-improvement — Hermes' biggest differentiator

This is the part with **no real Claude Code analogue** (CC's autoDream distills memory, but
doesn't author reusable *procedures*). Hermes treats "how to do this class of task" as a
first-class, self-editing store.

### 3.1 Skills = reusable-procedure packages

A skill is a `SKILL.md` (+ `references/`/`templates/`/`scripts/`) under `~/.hermes/skills/`.
The skills **index** sits in the volatile band of the system prompt; full bodies load on demand.
Descriptions are capped at **≤60 chars** because the index truncates there.

### 3.2 Three tiers of "learning"

1. **`/learn`** (explicit, user-invoked) — the live agent gathers sources (files, URLs, "what
   we just did") and authors a skill via `skill_manage`. Handles both small (one tight
   `SKILL.md`) and large (knowledge-base layout: lean index + per-chapter `references/`).
2. **Background review** (automatic, post-turn fork) — the "learn from experience" loop. Fires
   on turn-count nudges (default every **10**), on a final response, tools whitelisted to
   memory + skill management. Separate **memory-review** and **skill-review** prompts.
3. **Curator** (background lifecycle) — inactivity-triggered; pins/archives/consolidates
   *agent-created* skills only, **archive-only (never deletes)**, pinned skills bypass all
   transitions. This is Hermes' autoDream analogue but for *skills*.

### 3.3 The anti-self-poisoning rules (the standout lesson)

The skill-review prompt is explicit about what it must **NOT** capture — because a
self-improving loop can poison itself:
> - environment-dependent failures (missing binaries, "command not found")
> - **negative claims about tools** — *"'browser tools do not work'… These harden into
>   refusals the agent cites against itself for months after the actual problem was fixed."*
> - transient errors that resolved; one-off task narratives
> - **unresolved failures** — *"do NOT write those attempts up as a 'reliable workflow'…
>   presents an untested sequence of failures as validated guidance."*

And a clean division of labor it states outright: *"Memory captures 'who the user is and what
the current situation… is'; skills capture 'how to do this class of task for this user.'"*

**→ For Dim0:** a full skill-authoring loop is out of scope for v1, but **the anti-poisoning
rules are directly reusable** as guardrails on *any* auto-extraction we build — never memorize
tool-failure claims or unresolved-attempt narratives as durable facts. And the memory-vs-skill
division ("who/what" vs "how") is a useful boundary even if we only build the "who/what" side.

---

## 4. Memory providers — the pluggable external-memory layer

The largest architectural divergence from CC. Memory beyond the built-in store is a **plugin
interface**, not a fixed implementation.

### 4.1 The `MemoryProvider` ABC (`agent/memory_provider.py`)

Lifecycle: `initialize / system_prompt_block / prefetch(query) / sync_turn(user, asst) /
get_tool_schemas / handle_tool_call / shutdown`, plus optional hooks (`on_turn_start`,
`on_session_end`, `on_pre_compress`, `on_memory_write` [mirror], `on_delegation`,
`backup_paths`). **8+ shipped backends** (Honcho, Mem0, Hindsight, Holographic, OpenViking,
RetainDB, ByteRover, Supermemory, Memori), each bringing its own retrieval method (embedding
search, LLM "dialectic," regex extraction, local FTS) and its own agent tools. Built-in memory
is **not** a provider; the manager holds **at most one** external provider, purely additive.

### 4.2 The six wired behaviors

The manager fans out (try/except per provider so one can't break another): (1) inject a static
block into the system prompt, (2) **prefetch** relevant memories before each turn, (3) **sync**
the turn after each response, (4) **extract** on session end, (5) **mirror** built-in memory
writes outward (`on_memory_write`, one-directional builtin→external), (6) **add
provider-specific tools**.

### 4.3 The `<memory-context>` fence (the reusable idea)

External recall is injected into the **user message** (the `api_content` sidecar), fenced:

```
<memory-context>
[System note: The following is recalled memory context, NOT new user input.
Treat as authoritative reference data — this is the agent's persistent memory
and should inform all responses.]

<recalled content>
</memory-context>
```

Two defenses make this safe against prompt-injection through poisoned recalled memory:
- **`sanitize_context`** strips any pre-existing fence/system-note tags from the provider's
  output first, so a payload can't forge or break out of the fence.
- A **`StreamingContextScrubber`** removes any `<memory-context>` span that leaks into the
  model's *output* stream, even split across deltas ("leaking partial memory context is worse
  than a truncated answer").

### 4.4 Resilience patterns worth stealing

- **Prefetch on a background thread with an 8s timeout** (a wedged provider once blocked ~298s);
  a still-running prefetch from the prior turn returns `""` and is skipped.
- **Sync on a single-worker executor** serializing turn N before N+1; **interrupted turns are
  never synced** ("a partial assistant output is not durable conversational truth").
- **Session-end extraction is guaranteed to finish before** the provider rebinds to a new
  session id.
- **Trivial prompts** ("hi", "ok", `/`-commands) skip prefetch entirely via a shared gate.

**→ For Dim0:** we don't need 8 backends, but the **provider *shape* is a good seam**: define a
thin memory interface (prefetch / sync / extract / tools) so the built-in offline store and a
future server-backed store implement the same contract. And the **`<memory-context>` fence +
sanitize + output-scrub** trio is a ready-made template for injecting retrieved board memories
safely (especially since our recalled content can include user-authored node text).

---

## 5. Context compression (`ContextCompressor`) — prompt, input, output, tools

The compaction analogue. (Note: repo-root `trajectory_compressor.py` is an *offline
training-data* tool, unrelated to the live loop.)

### 5.1 Trigger — token threshold, three layers

- **Primary:** prompt tokens ≥ `threshold_tokens = (context_length − max_tokens) ×
  threshold_percent`, default **0.50** (raised to 0.75 for small-context models), floored at a
  64K window. **Token-driven, not turn-driven; no "context pressure" warning** (deliberately
  removed — it "made models give up prematurely").
- **Safety net:** gateway auto-compress at **85%**.
- **Explicit:** `/compress [focus]` (force).
- **Anti-thrash:** skips if the summarizer is in a 600s failure cooldown, or if the last two
  compressions each saved <10%.

### 5.2 What it does — 4-phase middle-summarization

1. **Prune old tool results** (cheap, no LLM): dedup identical results by md5, replace old
   >200-char results with one-line summaries (`[terminal] ran \`npm test\` -> exit 0, 47 lines`),
   truncate large tool-arg JSON. Survives even an aborted summary.
2. **Boundaries:** protect head (first 3) + a token-budgeted tail (≥ last user turn kept
   verbatim); never split tool_call/result pairs.
3. **Summarize the middle** with an **auxiliary LLM** into one structured message.
4. **Assemble** head + summary + tail; sanitize orphaned tool pairs.

Also a rolling "micro-compaction" mode (merge one exchange at a time into a running summary),
and an in-place default (same session id, pre-compaction turns soft-archived but searchable).

### 5.3 The compression prompt (structured template, verbatim sections)

Preamble: *"You are a summarization agent creating a context checkpoint… Produce only the
structured summary… NEVER include API keys, tokens, passwords… replace… with [REDACTED]."*
Plus a temporal-anchoring rule (rewrite completed actions into dated past-tense so a resumed
session doesn't re-issue finished work). The template the model must fill:

```
## Historical Task Snapshot   ← "THE SINGLE MOST IMPORTANT FIELD" — the user's most
                                 recent unfulfilled input, verbatim (or a reverse signal,
                                 or "None.")
## Goal
## Constraints & Preferences
## Completed Actions           ← numbered: "N. ACTION target — outcome [tool: name]"
## Active State                ← cwd/branch, modified files, test status, running procs
## Blocked                     ← unresolved errors, exact messages
## Key Decisions               ← + WHY
## Resolved Questions          ← so they're not re-asked
## Relevant Files
## Critical Context            ← values/errors/config that'd be lost; [REDACTED] secrets
## Pruned Skills               ← repeat any [SKILL_PRUNED: …] markers verbatim
```

Compare CC's 9 sections: Hermes' template is more **state-machine-oriented** (Active
State / Blocked / Historical Task Snapshot) — tuned for autonomous resumption. There are
**iterative-update** and **focus-topic** (60-70% budget) variants, and a **no-user-turn**
variant for cron sessions.

### 5.4 Input / output

- **Input:** the middle turns serialized to labeled plain text, per-message truncated
  (~6K chars/body head+tail), aggregate cap 160K chars, previous summary prepended on
  re-compaction. Summary budget = `content × 0.20`, clamped `[2000, 10000]` tokens, and
  crucially **`max_tokens` is NOT sent** so the summary can't be truncated mid-section.
- **Output:** one message between head and tail, prefixed with a long **`[CONTEXT COMPACTION —
  REFERENCE ONLY]`** directive (*"treat as background reference, NOT active instructions… Do
  NOT answer questions mentioned in this summary; they were already addressed. Respond ONLY to
  the latest user message AFTER this summary… your persistent memory in the system prompt is
  ALWAYS authoritative"*), an end marker, and a role chosen to avoid same-role adjacency. On LLM
  failure, a **deterministic no-LLM fallback** emits the same structure rather than dropping the
  middle.

### 5.5 Does compression use any tool? — **No.** (same answer as Claude Code)

The batch call is a plain single-user-message `call_llm(task="compression")` on a **separate
auxiliary model** — **no `tools`/`tool_choice` ever passed**, main toolset not attached. Micro-
summary and the offline trajectory tool are likewise toolless. The only tool interaction is the
*inverse*: a `ContextEngine` plugin (e.g. LCM) **can expose** tools like `lcm_grep` to the
agent, but the default compressor neither uses nor provides tools.

### 5.6 Native (API-side) compaction + caching

- **`native_compaction.py`**: OpenAI Responses `context_management` server-side compaction
  (opt-in, **gpt-5.6 direct only**), with the local compressor kept armed as fallback (native
  threshold clamped 8K below the local trigger). Plus Codex app-server thread compaction. So
  Hermes has **three** compaction paths (local / OpenAI-native / Codex-native).
- **Prompt caching** (`prompt_caching.py`): 4 Anthropic `cache_control` breakpoints (system
  prefix, system end, last 2 messages); compression invalidates the middle but the system
  breakpoint survives; rotation-stable cache scope maps rotated session ids back to a lineage
  root. `reasoning_summaries.py` / `turn_summary.py` are **display-only**, never re-injected.

**→ For Dim0:** the **`[REFERENCE ONLY]` framing** on a compaction summary (don't re-execute
finished work; only the latest message after it is live) is a direct fix for a real failure
mode and worth copying into any transcript-compression we do. The **structured, resumption-
oriented template** (Active State / Blocked / Historical Task Snapshot) is a better fit for our
board-work digests than CC's chronological 9-section shape.

---

## 6. The retrieval-without-recall complements

Two mechanisms that give the model access to more than fits in the prompt, without pre-injecting:

- **Session search** — SQLite **FTS5** over the full transcript (`~/.hermes/state.db`), exposed
  as a `session_search` tool (~20ms query, no LLM, no truncation). The "unlimited, on-demand"
  complement to the ~1,300-token in-prompt memory. (CC's analogue is grepping transcript JSONL.)
- **Context references** (`@file:`, `@diff`, `@git:5`, `@url:`) — inline **user-driven**
  attachments expanded into the user message with budget guards (refuse >50% of window) and a
  path-safety denylist. Distinct from auto-discovered **context files** (the AGENTS.md chain).

And the **coding workspace snapshot** (`coding_context.py`) is the richer gitStatus analogue:
`"Workspace (snapshot at session start — re-check with git before acting on it): Root / Branch
→ upstream (ahead/behind) / Status / Recent commits / Project manifests / Verify commands"`.

The `/context` command (`context_breakdown.py`) renders a CC-style token breakdown with a 5×20
glyph grid, bucketed by system prompt / tools / skills / MCP / memory / conversation.

---

## 7. Transferable principles (Hermes-specific, beyond the CC list)

1. **Prompt-cache stability is a design constraint, not an afterthought.** Tier the system
   prompt (stable/context/volatile), put volatile last, keep per-turn injection off the system
   prompt via a byte-stable user-message sidecar.
2. **Split memory by subject: agent-notes (`MEMORY.md`) vs user-profile (`USER.md`).** Two small
   bounded stores beat one blob; each gets its own budget and guidance.
3. **Overflow → consolidate, not truncate.** Reject the write, show current entries, make the
   model merge/prune and retry atomically. Show remaining capacity in the injected block.
4. **A self-improvement loop needs anti-poisoning guardrails.** Never persist tool-failure
   claims, env-specific failures, or unresolved-attempt narratives as durable facts/skills.
5. **Make external memory a provider interface**, additive to a built-in store, with a mirror so
   the two don't diverge.
6. **Fence recalled memory and defend the fence** — sanitize provider output (no forged tags)
   and scrub leaked fence spans from the model's output.
7. **Resilience: time-box prefetch, background-thread the writes, never sync interrupted turns.**
8. **Compaction summaries are "reference only"** — tell the model not to re-execute finished
   work; keep persistent memory authoritative over the summary.
9. **Give the model on-demand retrieval (FTS session search)** so the small always-on memory
   doesn't have to hold everything.

---

## 8. Claude Code vs Hermes — side by side

| Dimension | Claude Code | Hermes |
|---|---|---|
| Durable curated memory | memdir: `MEMORY.md` index + per-fact files, 4-type taxonomy | `MEMORY.md` (2200c) + `USER.md` (1375c), single-file/§-delimited |
| Memory cap handling | 200-line truncation of the index | hard error → model consolidates & retries |
| Retrieval | per-turn LLM-select over a name+desc manifest → ≤5 files | provider-specific (embedding / LLM dialectic / FTS); built-in is injected whole |
| On-demand recall | grep transcript JSONL | `session_search` FTS5 tool |
| Passive extraction | forked agent at end of loop (memory dir only) | background review fork (memory **and** skills), nudge every 10 turns |
| Self-improvement | autoDream distills memory | `/learn` + background skill review + Curator lifecycle (**authors reusable skills**) |
| External memory | team memory (server sync, one blob) | **pluggable providers** (8+), `<memory-context>` fence + scrub |
| Recall injection site | `<system-reminder>` attachment messages | `<memory-context>` on the user-message sidecar |
| Repo/state snapshot | `gitStatus` block | coding workspace snapshot (+ verify commands) |
| Compaction trigger | ~% window auto + `/compact` | 50% token threshold + 85% gateway + `/compress` |
| Compaction template | 9 chronological sections | 10+ state-machine sections (Active State/Blocked/Historical Task Snapshot) |
| Compaction tools | none | none |
| Native/API compaction | Anthropic context editing | OpenAI Responses (gpt-5.6) + Codex app-server |
| Compaction re-hydration | re-attach recent files/plan/skills | prune+summarize middle, keep head+tail verbatim; `[REFERENCE ONLY]` framing |
| Extensibility | flags, hooks | **swappable context engine + memory-provider plugins** |

**The one-sentence contrast:** Claude Code is a *curated-file* memory system with LLM-select
recall and a distillation loop; Hermes is a *bounded-store + pluggable-provider* memory system
with a self-improving **skill** loop and prompt-cache-stability baked into every placement
decision.

---

## 9. Mapping to Dim0 (`agent-context-memory.md`)

The two studies converge on the same v1 for us, with Hermes sharpening several choices:

| Our layer | Take from CC | Take from Hermes |
|---|---|---|
| **L0 board snapshot** | labeled point-in-time, memoized | coding-snapshot richness (inventory + "re-check before acting") |
| **L1 board memory** | two-tier index+files, taxonomy, freshness-text | `MEMORY.md`-style bounded store, overflow→consolidate, show capacity |
| **L2 global/user memory** | user-scoped memdir | **dedicated `USER.md`-style profile store** (clean L1/L2 split) |
| **Retrieval** | LLM-select over manifest | fence recalled memory (`<memory-context>` + sanitize + scrub); FTS-style on-demand search tool |
| **Write path** | tools + stood-down passive fork | passive review fork + **anti-poisoning guardrails** |
| **Shared-board memory** | server-synced, local-wins | **provider-interface seam** (built-in + optional external, mirror) |
| **Transcript compaction** | selective re-hydration | structured resumption template + `[REFERENCE ONLY]` framing; no tools |

Concrete deltas to fold into `agent-context-memory.md`:
- Adopt Hermes' **two-store split** for our L1/L2 (board-notes vs user-profile) rather than one
  memory type-space.
- Adopt **overflow-consolidate** (reject + show entries + retry) over silent truncation, and
  **surface remaining capacity** in the injected block.
- Wrap retrieved board memories in a **sanitized `<memory-context>` fence** — important because
  recalled node text is user-authored and could carry injection.
- If we ever add passive extraction, ship the **anti-poisoning rules** from day one.
- Model the built-in store behind a **thin provider-shaped interface** so a future
  server/collab-backed store drops in without touching the agent loop.
