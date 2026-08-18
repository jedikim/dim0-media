# Inspiration: how Claude Code solves memory & context

A study of the leaked Claude Code source (`~/workspace/leak-claude-code/`), written to
inform our own board-agent memory design (`agent-context-memory.md`). This is a
*reference* — it explains mechanisms, quotes the load-bearing prompts, and ends with the
transferable principles. File paths cite the leak; verify before relying on a detail.

## TL;DR — it's not one system, it's five

The single biggest lesson: Claude Code does **not** have "a memory feature." It has five
distinct subsystems operating at different time horizons and granularities, each with its
own store, trigger, and prompt. Conflating them is the mistake.

| # | Subsystem | Horizon | Store | Purpose |
|---|---|---|---|---|
| 1 | **Persistent memory (memdir)** | across sessions, forever | `~/.claude/projects/<repo>/memory/*.md` | durable facts about the user & project |
| 2 | **CLAUDE.md tree** | across sessions (human-authored) | files in the repo tree | rules/conventions the human curates |
| 3 | **Session memory** | one session | `<session>/session-memory/summary.md` | rolling structured notes → cheap compaction |
| 4 | **Compaction + microcompact** | within a session, on demand | (transforms the message array) | keep the context window from overflowing |
| 5 | **Dream (assistant mode)** | nightly | daily logs → distilled topic files | turn an append-only log into curated memory |

Two axes separate them: **auto-derived vs curated** (compaction/snapshot are derived and
lossy; memdir/CLAUDE.md are curated and durable), and **static vs per-turn** (CLAUDE.md is
assembled once and cached; relevant-memory recall runs every turn).

---

## 1. The assembly model: context is layered, and injected at three sites

Every request is assembled from pieces that land in **three different places** — this
separation is deliberate and worth copying.

| Payload | Content | Injection site | Cached? |
|---|---|---|---|
| Memory **mechanics** | the taxonomy, "how to save", "when to access" — *instructions, no data* | **system prompt** section | session |
| CLAUDE.md tree + `MEMORY.md` **index** + date | the actual durable content | **first user message**, wrapped in `<system-reminder>` | session |
| `gitStatus` | branch/status/recent commits snapshot | **system prompt tail** | session |
| **Relevant memories** (topic files) | retrieved-for-this-query full facts | **mid-turn attachment messages**, `<system-reminder>` wrapped | **per turn** |

Key subtleties:

- **Mechanics are separated from content.** `loadMemoryPrompt()` injects only *how memory
  works* into the system prompt; the actual `MEMORY.md` bytes ride in the user-context
  message. This keeps the cacheable system prompt stable while content varies.
- **The user-context block is fenced and hedged.** It's one `isMeta` user message that ends
  with: *"IMPORTANT: this context may or may not be relevant to your tasks. You should not
  respond to this context unless it is highly relevant to your task."*
- **`gitStatus` is explicitly a snapshot.** *"This is the git status at the start of the
  conversation. Note that this status is a snapshot in time, and will not update during the
  conversation."* — it tells the model the freshness contract up front.
- **Static context is memoized for the whole conversation** (`getSystemContext`,
  `getUserContext`, `getGitStatus`, `getMemoryFiles` are all `lodash memoize` with a single
  slot), and explicitly `.cache.clear()`'d on the events that invalidate it (`/compact`,
  `/clear`, worktree enter/exit, settings sync, the `/memory` editor).
- **Only recall is per-turn.** `startRelevantMemoryPrefetch` fires *once per user turn*
  (not per loop iteration — "the prompt is invariant across iterations").

**→ For Dim0:** mirror the split — a small always-on *mechanics* block, an always-on
*index + board snapshot* block, and *per-turn retrieved* memories as separate attachment
messages. Memoize the static parts per run; only recall recomputes.

---

## 2. Persistent memory (memdir) — the durable, curated store

This is the closest analogue to what we want for L1/L2. Its design in five parts.

### 2.1 Two-tier storage: an always-loaded index + on-demand fact files

- `MEMORY.md` is an **index**, always in context, hard-capped at **200 lines / 25KB**
  (truncated with a warning naming which cap fired). Each line is a pointer:
  `- [Title](file.md) — one-line hook`. *"Never write memory content directly into
  MEMORY.md."*
- Each fact is its **own `.md` file** with frontmatter (`name`, `description`, `type`).
- This is what keeps always-on cost **flat** while the memory grows unbounded. The index is
  cheap; bodies load only when retrieved.

### 2.2 The closed 4-type taxonomy + the one governing rule

Memories are constrained to four types, and one rule does most of the work:

> **Never save what's derivable from current state.** *"Code patterns, conventions,
> architecture, file paths, git history, debugging fixes, anything already in CLAUDE.md,
> ephemeral task state — do NOT save. These can be derived by reading the current project
> state."*

| Type | Captures | Body structure |
|---|---|---|
| `user` | role, expertise, goals, preferences — "who they are, how to be most helpful" | freeform |
| `feedback` | corrections **and confirmations** of how to work | rule + **Why:** + **How to apply:** |
| `project` | ongoing work/decisions/incidents not in code or git; convert relative→absolute dates | fact + **Why:** + **How to apply:** |
| `reference` | pointers to external systems (dashboards, Linear, Slack) | freeform |

Two sharp details in the prompt: save from **success as well as failure** (*"if you only
save corrections, you will avoid past mistakes but drift away from approaches the user has
already validated"*), and the explicit-save gate — *"These exclusions apply even when the
user explicitly asks you to save. If they ask you to save a PR list, ask what was
*surprising* or *non-obvious* about it — that is the part worth keeping."*

### 2.3 How-to-save, when-to-access, and drift discipline

- **Save is two-step, dedup-first:** write the fact file, then add the index pointer;
  *"First check if there is an existing memory you can update before writing a new one."*
- **When to access:** when relevant or asked; and a precise anti-pattern for "ignore
  memory" — *"proceed as if MEMORY.md were empty. Do not apply remembered facts, cite,
  compare against, or mention memory content."*
- **Drift discipline** (eval-tuned into its own section, *"Before recommending from
  memory"*): a memory naming a file/function/flag is a claim it existed *when written* —
  *"'The memory says X exists' is not the same as 'X exists now.'"* Verify before
  recommending; trust what you observe now; update/remove the stale entry.

### 2.4 Retrieval is a cheap LLM side-query — not embeddings

The whole recall path, per turn:

1. `scanMemoryFiles` reads only the **first 30 lines** (frontmatter) of each `.md`, newest
   first, capped at **200 files**. Builds a manifest: `- [type] filename (ISO-timestamp): description`.
2. A **Sonnet side-query** (`max_tokens: 256`, JSON-schema output) picks **≤5** files it is
   *certain* are useful: *"Only include memories that you are certain will be helpful based
   on their name and description… If you are unsure… do not include it. Be selective."*
   Nice touch: it de-prioritizes reference docs for tools *already in active use*, but keeps
   *gotchas/warnings* about them.
3. Selected files are read (capped 200 lines / 4KB, with a "use Read for the full file"
   note) and injected as `<system-reminder>` **attachment messages**, each headed with its
   path + freshness.

**No vector store, no embeddings.** The "index" is literally the markdown pointer list; the
"retrieval model" is an LLM reading names + descriptions. De-dup and byte-budget
(`MAX_SESSION_BYTES = 60KB`) are enforced by *scanning prior attachments in the transcript*
— so compaction naturally resets recall.

### 2.5 Freshness, not decay

Age is computed from file **mtime** and surfaced to the model as **text**, never used to
expire or down-rank:

> *"This memory is N days old. Memories are point-in-time observations, not live state —
> claims about code behavior or file:line citations may be outdated. Verify against current
> code before asserting as fact."* (emitted only for memories > 1 day old)

Rationale in the source: *"Models are poor at date arithmetic — a raw ISO timestamp doesn't
trigger staleness reasoning the way '47 days ago' does."*

### 2.6 The passive extraction pass

Beyond the model saving memories itself, a **background forked agent** mines each turn:

- **Runs at the end of each query loop** (final response, no tool calls), fire-and-forget.
- It's a **perfect fork of the main conversation** (same system prompt + prefix → shares the
  prompt cache), `maxTurns: 5`, tools locked to Read/Grep/Glob + Edit/Write **only inside
  the memory dir** (read-only Bash, no `rm`, no MCP).
- **Mutually exclusive with the main agent:** if the main agent already wrote memory this
  turn, the pass skips. So you get exactly one writer per turn.
- Efficiency instruction: *"turn 1 — issue all Read calls in parallel; turn 2 — issue all
  Write/Edit calls in parallel. Do not interleave."* And a hard scope: *"only use content
  from the last ~N messages… no grepping source files, no git commands."*
- Dedup/indexing are **prompt-instructed, not code-enforced** (the fork *is* the writer).

### 2.7 Where it lives + team memory

- Path: `~/.claude/projects/<sanitized-canonical-git-root>/memory/`. Keyed on the
  **canonical git root**, so all worktrees of one repo share one memory dir.
- **Team memory** = a `team/` subdir, shared across org members on the same GitHub repo,
  synced over an **HTTP API to Anthropic's backend (not git)**: delta push (upload only
  changed keys by checksum), **local-wins** conflict resolution, 2s-debounced `fs.watch`,
  deletions don't propagate. Private-vs-team is the **model's** choice via per-type
  `<scope>` prompt guidance. A **three-layer secret scanner** (curated gitleaks subset)
  blocks/redacts credentials before anything leaves the machine.
- **No schema versioning/migration** — records are schemaless markdown+frontmatter; tolerant
  parsing (`parseMemoryType` narrows unknown → undefined) handles evolution.

**→ For Dim0:** 2.1–2.5 map almost directly onto L1/L2. The manifest-based LLM-select is a
strong fit (we don't need vectors for small volumes). "Freshness-as-text" is trivial and
high-value. Team memory ≈ our "collaborative shared-board memory" — note they chose a
server sync with local-wins + secret scanning, which validates our instinct to keep the
server dumb and the client authoritative.

---

## 3. Session memory — per-session rolling notes, for cheap compaction

A **different** system from memdir, often confused with it. Distinct store, distinct job.

- **What:** *"a markdown file with notes about the current conversation… maintained
  periodically in the background using a forked subagent."* One file per session:
  `<session>/session-memory/summary.md`. Fixed template sections: *Session Title, Current
  State, Task specification, Files and Functions, Workflow, Errors & Corrections, Codebase
  Documentation, Learnings, Key results, Worklog.*
- **Who writes it:** a **forked note-taker subagent** that may *only* call `Edit`, *only* on
  that one file. It rewrites sections in place, preserving the template skeleton exactly
  (the italic instruction lines are load-bearing structure).
- **When:** after the context reaches ~10K tokens (init), then every ~5K token growth **and**
  ≥3 tool calls (or at a natural no-tool break). Caps: **2K tokens/section, 12K total**; when
  over budget the model is told to *"aggressively shorten oversized sections… Prioritize
  keeping Current State and Errors & Corrections."*
- **Why it exists — the real payoff:** when the window fills, compaction can reuse the
  already-fresh notes **as** the summary, with **no summarization LLM call**. It also gives
  cross-session resumption: reopen a session whose `summary.md` survives → the notes become
  the summary.
- Anti-leak framing in the prompt: *"This message and these instructions are NOT part of the
  actual user conversation. Do NOT include any references to note-taking… in the notes."*

**→ For Dim0:** this is the model for a **live board-work digest** — a rolling "what's the
user doing on this board right now" that's cheaper than re-summarizing chat history, and
doubles as our transcript-compaction summary (relevant to the Phase-2 opaque-blob
transcripts). Distinct from L1 board *memory* (durable facts) — this is ephemeral working
state.

---

## 4. Context-window management — layered escalation, cheapest first

Not one "summarize" step — a ladder, applied least-lossy first:

1. **Microcompact (per-turn):** clears old **tool-result payloads** (not the conversation)
   when the prompt cache is presumed cold (>60min gap) or by count, replacing bodies with
   `[Old tool result content cleared]`. Plus **API-native** context edits
   (`clear_tool_uses` / `clear_thinking`) applied server-side without busting the cache.
2. **Session-memory compaction:** reuse the fresh `summary.md` as the summary — no LLM call.
3. **Full compaction:** an LLM summary with a **fixed 9-section structure** — *Primary
   Request & Intent, Key Technical Concepts, Files and Code Sections, Errors and fixes,
   Problem Solving, **All user messages**, Pending Tasks, Current Work, Optional Next Step*.
   The model first writes a private `<analysis>` scratchpad, then the `<summary>` (the
   scratchpad is stripped). Notable: "All user messages" is preserved deliberately, and
   "Optional Next Step" demands *verbatim quotes* of the last task "to ensure there's no
   drift in task interpretation."
4. **Selective re-hydration** (the clever part): compaction discards raw history but
   surgically **re-injects** the last ≤5 read files (≤5K each, 50K total), the active plan,
   invoked-skill text, and tool/agent/MCP availability — so the model doesn't wake up amnesiac
   about its environment. Final order: `boundary marker → summary → kept recent messages →
   re-hydrated attachments → hook output`.

Token gauge: **exact anchor from the last API `usage` response + a rough char-based estimate
of the un-billed tail** (4 bytes/token, but 2 for JSON; images/docs hardcoded to 2000).
Auto-compact fires at `effectiveWindow − 13K`; a circuit breaker stops after 3 consecutive
failed compactions.

**→ For Dim0:** the escalation ladder and especially **selective re-hydration** are the
lessons. When we compact a long board-chat transcript, don't just summarize — re-attach the
current board snapshot + recently-touched nodes so the agent stays oriented.

---

## 5. The dream loop (assistant mode) — logs → nightly distillation

For long-lived "assistant" sessions, memdir flips from live-index to **append-only log +
nightly distill**:

- **Producer:** the agent **appends** timestamped bullets to `logs/YYYY/MM/YYYY-MM-DD.md` —
  *"Do not rewrite or reorganize the log — it is append-only."* It never touches `MEMORY.md`
  directly.
- **Consumer (`autoDream`):** a forked agent, gated to run **≥24h apart** and after **≥5
  sessions**, behind a PID lock. It runs a 4-phase distillation — *Orient* (read MEMORY.md +
  existing topic files), *Gather* (daily logs + drifted memories + narrow transcript greps),
  *Consolidate* (merge into topic files, absolute-ize dates, **delete contradicted facts**),
  *Prune & index* (rewrite `MEMORY.md` ≤200 lines/25KB of pointers, demote verbose lines,
  resolve contradictions).

The distillation prompt is a clean template worth copying nearly verbatim if we ever want
this — its phase structure ("orient → gather → consolidate → prune") is the reusable shape.

**→ For Dim0:** probably **out of scope for v1**, but it's the answer to "how does curated
memory stay clean over time without the main agent spending turns on housekeeping" — a
separate, throttled, forked distiller. Worth keeping in the back pocket.

---

## 6. User-facing surfaces

- **`/memory`** is an **editor launcher**, not a viewer — pick a CLAUDE.md-family file, open
  it in `$EDITOR`. Memory is human-editable by design.
- **`/context`** is a **visualizer** of what the model actually sees — it applies the same
  transforms as a real request, then renders a **token breakdown by bucket** (per
  system-prompt section, per memory file, CLAUDE.md total). Great for "why is my context
  full."

**→ For Dim0:** a "what does the agent know about this board" panel (the assembled snapshot
+ index + retrieved memories, with token counts) would be both a debugging tool and a trust
feature.

---

## 7. Transferable principles (the distilled takeaways)

1. **Separate the subsystems by time horizon.** Durable curated memory, ephemeral session
   digest, and window-compaction are three different problems — don't build one blob.
2. **Two-tier storage keeps always-on cost flat:** a capped, always-loaded *index* +
   *on-demand* fact bodies. Grow the store without growing the base prompt.
3. **The governing rule is "don't store what's derivable."** For us: don't memorize what
   reading the board would tell you — that's the snapshot's job.
4. **A closed, small taxonomy with per-type save/access/why guidance** beats freeform notes.
   Steal `user`/`feedback`/`project`/`reference` and the **Why:/How to apply:** body shape.
5. **Retrieval can be a cheap LLM side-query over name+description** — no vector store needed
   at small scale. Be strict ("only if certain", ≤5).
6. **Inject content at the right site with the right freshness contract.** Mechanics in the
   system prompt; content fenced in a hedged user message; per-turn recall as separate
   attachments; snapshots labeled "as of now, won't update."
7. **Freshness as text, not decay.** Tell the model "N days old, verify before asserting" —
   don't silently expire.
8. **One writer per turn.** A passive extraction fork that *stands down* when the main agent
   already wrote avoids double-writes and keeps the main loop cheap.
9. **Compaction is lossy summary + selective re-hydration**, not just summary. Re-attach the
   environment (files, plan, snapshot) so the agent stays oriented.
10. **Keep the server dumb, the client authoritative** (team memory: delta push, local-wins,
    secret-scan before egress). Validates our offline-first + opaque-backup instinct.
11. **Make it inspectable and editable** (`/context`, `/memory`). Memory the user can see and
    correct is memory the user trusts.

---

## 8. Mapping back to our design (`agent-context-memory.md`)

| Our layer | Closest CC subsystem | What to copy | What to drop for v1 |
|---|---|---|---|
| **L0 board snapshot** | `gitStatus` | snapshot + explicit freshness label, memoized per run | summarizer for huge boards (later) |
| **L1 board memory** | memdir (project scope) + team memory | two-tier index+files, taxonomy, LLM-select recall, freshness-text | team/collab sync (later), autoDream |
| **L2 global memory** | memdir (user scope) | same, user-scoped | — |
| **(future) work digest** | session memory | rolling structured notes → cheap transcript compaction | v1: skip |
| **(future) transcript compaction** | compaction ladder | selective re-hydration of the board snapshot | microcompact/API edits |

The open decisions in `agent-context-memory.md` now have CC precedents to lean on:
retrieval → **LLM-select over a manifest** (§2.4); write path → **tools + a stood-down
passive fork** (§2.6); shared-board memory → **server-synced, local-wins, secret-scanned**
(§2.7); snapshot → **labeled point-in-time, memoized** (§1).
