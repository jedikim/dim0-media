# Synthesis: agent memory & context across Claude Code, Hermes, and mem0

Cross-cutting synthesis of the three systems studied in depth
(`inspiration-claude-code-memory.md`, `inspiration-hermes-memory.md`,
`inspiration-mem0-and-landscape.md`). Two questions: **what is the recurrent design every one
of them converges on**, and **where do they genuinely differ** (those differences are the real
design decisions we'll have to make). This doc deliberately stops short of resolving anything
for Dim0 — that comes next, in `agent-context-memory.md`.

## The three in one line each

- **Claude Code** — a *curated-file* memory system: a capped `MEMORY.md` index + one file per
  fact, LLM-select retrieval, a nightly distillation loop. Human-editable, no vectors.
- **Hermes** — a *bounded-store + pluggable-provider* system: char-capped `MEMORY.md`/`USER.md`,
  a self-improving skill loop, an external-provider plugin layer, and prompt-cache stability
  baked into every placement decision.
- **mem0** — a *storage/retrieval library* (not an agent): LLM extraction → atomic facts,
  additive writes with deterministic dedup, hybrid vector+entity retrieval, scoped
  user/session/agent. The "memory backend" the others could plug in.

CC and Hermes are **harness** designs (assembly, injection, compaction, upkeep); mem0 is a
**backend** design (extract, store, retrieve). That asymmetry explains most of the differences
below — but the recurrent core holds across all three anyway.

---

## Part 1 — The recurrent design (what all three converge on)

Twelve patterns appear in all three (or in both harnesses + implied by mem0's shape). These are
the high-confidence, "this is just how it's done" core.

### 1. Memory ≠ context. Durable store, retrieved into a per-request window.
All three separate a **durable store** from the **live window** you assemble each turn. Nobody
keeps everything in the prompt; nobody retrieves from raw history alone.

### 2. Two-tier: a small always-on surface + a larger retrieved-on-demand store.
- CC: `MEMORY.md` index (always, capped 200 lines/25KB) + per-fact files (retrieved ≤5).
- Hermes: bounded `MEMORY.md`/`USER.md` block (always) + `session_search` FTS5 (on demand).
- mem0: (implicit) top-k retrieval each call; the caller injects the small result set.
The index/surface keeps always-on cost flat while the store grows unbounded.

### 3. Extract atomic, self-contained, scoped facts.
All three turn raw conversation into discrete facts, not transcripts.
- CC: 4-type taxonomy, one fact per file.
- Hermes: `memory` tool add/replace with a WHEN/SKIP rule.
- mem0: LLM extraction, "15–80 words, self-contained, never generalize."

### 4. A scope triad: user / session / agent(-or-project).
- mem0: `user_id` / `run_id` / `agent_id` (explicit).
- CC: user-scope vs project-scope (per-repo dir) + team scope.
- Hermes: `USER.md` (user) vs `MEMORY.md` (agent/project) + per-profile isolation.
"Who the user is" vs "what this workspace is" vs "the current session" is a universal axis.

### 5. "Don't store what's derivable." A hard exclusion rule.
- CC: *"Code patterns, architecture, git history… can be derived — do NOT save."*
- Hermes: SKIP list — *"trivial/obvious info, easily re-discovered facts, task progress."*
- mem0: extraction guardrails (`"There are branches in trees." → {"facts": []}`).
Memory is for the non-derivable; everything else is re-read at request time.

### 6. A cheap salience gate before extraction.
All three refuse to memorize noise: CC's "explicit-save gate" (ask what's *surprising*),
Hermes' trivial-prompt skip, mem0's empty-facts examples.

### 7. Facts are time-stamped, and freshness is surfaced — memory is a snapshot.
- CC: `"This memory is 47 days old… verify against current code before asserting."`
- Hermes: date-only timestamps; frozen snapshot with a "re-check with git" workspace banner.
- mem0: `created_at`/`updated_at`, temporal grounding ("convert relative → absolute dates").
And all three inject a **point-in-time contract**: the model is told the store may be stale and
to verify against current reality.

### 8. Injection is layered and *placed* deliberately, with content fenced.
Every system separates **mechanics** (how memory works) from **content** (the facts), and fences
content so the model treats it as reference, not instruction:
- CC: mechanics in system prompt; content in a hedged `<system-reminder>` user message;
  per-turn recall as separate attachments.
- Hermes: three-tier system prompt (stable/context/volatile) + per-turn recall in a
  `<memory-context>` block on the user message.
- mem0: returns results; the caller fences them (and Hermes-as-host does exactly this).

### 9. Retrieval is per-turn and top-k-bounded.
CC (LLM-select ≤5 per turn), Hermes (provider prefetch each turn), mem0 (top-k search) all
recompute relevance for the *current* query and cap what's injected.

### 10. Compaction is text-only, structured, and uses NO tools.
Both harnesses compress the conversation with a **plain single-shot summarization call on a
separate/aux model, no tools attached** (CC hard-denies tool calls; Hermes never passes a tools
key), into a **fixed-section template**, and both frame the result as **reference-only** so the
model doesn't re-execute finished work. (mem0 has no conversation loop, so N/A — but its
`procedural_memory` summarization is likewise a plain call.)

### 11. Persistent memory stays authoritative over the compaction summary.
CC and Hermes both explicitly tell the model: the summary is background; your persistent memory
(and current reality) win.

### 12. A background/asynchronous consolidation-or-review pass.
- CC: **autoDream** — nightly distill logs → curated `MEMORY.md` + topic files.
- Hermes: **background review** (post-turn) + **Curator** (skill lifecycle).
- mem0: no built-in pass, but the field's convergent answer (Anthropic "Dreaming", May 2026) is
  the same idea; mem0 leans on additive-accumulate instead.
Upkeep is a first-class, separate activity — not something the main loop does inline.

**The recurrent core, in one sentence:** *extract scoped atomic non-derivable facts → keep a
small always-on surface plus a retrieved-on-demand store → inject them fenced and time-stamped,
recomputed per turn → compress the conversation (not the memory) with a tool-less structured
summary → and consolidate the store in a background pass.*

---

## Part 2 — Where they genuinely differ (the real forks)

These are the dimensions where the three make *different* choices. Each is a decision we'll
inherit.

### 2.1 Comparison matrix

| Dimension | Claude Code | Hermes | mem0 |
|---|---|---|---|
| **Store form** | one file per fact + `MEMORY.md` index | two char-capped files (`MEMORY.md`+`USER.md`) | vector rows + entity collection + SQLite history |
| **Cap unit** | lines/bytes (200 lines/25KB index) | **characters** (2200 / 1375), "model-independent" | none (unbounded; retrieval-gated) |
| **Overflow handling** | truncate the index (+warning) | **reject → model consolidates → retry** | never overflows (accumulate) |
| **Write consistency** | agent + passive fork write files; dedup by prompt | agent tool + background review; dedup by prompt | **additive + deterministic MD5 dedup**; no LLM mutation |
| **UPDATE/DELETE** | model edits/removes files | model replace/remove; overflow forces it | explicit API only; classic LLM decision-loop now **dead code** |
| **Retrieval** | **LLM-select over name+desc manifest** (≤5) | provider-specific (embedding / LLM dialectic / FTS) | **hybrid: semantic + BM25 + entity boost**, no LLM |
| **Vectors/embeddings?** | **none** | optional (via provider) | **yes, core** |
| **On-demand recall** | grep transcript JSONL | `session_search` FTS5 tool | the whole store is on-demand |
| **User profile** | folded into `user`-type memories | **dedicated `USER.md` store** | `user_id`-scoped facts |
| **Procedural memory** | — (no reusable procedures) | **skills** (first-class, self-authored) | `procedural_memory` mode (agent run summaries) |
| **Self-improvement** | autoDream distills *memory* | `/learn` + review + Curator author *skills* | none (library) |
| **External/shared memory** | team memory (server sync, one blob) | **pluggable provider interface** (8+ backends) | it *is* the pluggable backend |
| **Injection site for recall** | `<system-reminder>` attachment | `<memory-context>` on user-message sidecar | caller's choice |
| **Prompt-cache concern** | present (memoize) | **central design driver** (3-tier, sidecar, frozen snapshot) | N/A (library) |
| **Consolidation** | nightly dream (time+session gated) | Curator (inactivity) + per-turn review | additive-accumulate (no pass) |
| **Compaction template** | 9 chronological sections | 10+ state-machine sections (Active State/Blocked) | N/A |
| **Native/API compaction** | Anthropic context editing | OpenAI Responses + Codex app-server | N/A |
| **Editability** | `/memory` opens files in `$EDITOR` | `/journey`, write-approval gate | API + history/audit trail |
| **Poisoning defense** | (light) | **scan on write+load; anti-self-poisoning rules; fence scrub** | (relies on host) |

### 2.2 The four decisions that actually matter (where the disagreement is load-bearing)

Most rows above are cosmetic. Four are genuine forks:

**A. Write consistency: LLM mutation loop vs additive + deterministic dedup.**
This is the sharpest disagreement — and it *moved*. mem0 **abandoned** its own LLM
ADD/UPDATE/DELETE decision loop for additive writes with hash dedup (cheaper, no hallucinated
destructive edits; the store grows and leans on retrieval ranking). CC/Hermes still let the model
edit/remove, but gate it (overflow-forced consolidation in Hermes; passive-fork-writes-once in
CC). Zep's "close, never delete" (temporal) is a third answer. **The trend is away from
write-time LLM mutation.**

**B. Retrieval: LLM-select vs vector/hybrid.**
CC proves you can skip embeddings entirely — an LLM picks ≤5 files from a name+description
manifest. mem0 is full hybrid (semantic+BM25+entity). Hermes punts to the provider. The choice is
**scale-dependent**: LLM-select is dead simple and great at small N; hybrid scales but is
machinery. This is the single biggest "what do we actually need" question for us.

**C. Overflow: truncate vs consolidate vs accumulate.**
CC truncates the index; Hermes rejects the write and makes the model consolidate (and shows
remaining capacity); mem0 never caps (accumulate + retrieve). Three coherent philosophies for the
same problem.

**D. Upkeep: distill (dream) vs review-loop (skills) vs accumulate-and-forget.**
CC distills memory nightly; Hermes runs a per-turn review *and* a Curator, and authors reusable
*skills* (a capability the other two lack); mem0 does no upkeep and relies on additive growth +
ranking. How much background machinery is worth it is a real cost/benefit call.

### 2.3 The one capability only Hermes has

**Procedural self-improvement — the agent authoring and maintaining its own reusable skills.**
Neither CC (distills *facts*) nor mem0 (stores *facts*) turn "how we did this class of task" into
a reusable, self-editing artifact. It's the most ambitious idea in the set — and the one with the
most explicit **guardrails** (anti-self-poisoning rules), because a self-editing capability store
can corrupt itself.

---

## Part 3 — The shape of the decision space (for the next pass)

Reading the recurrent core + the four real forks together, the design space for *our* system
collapses to a few choices, each with a clear default the evidence points to:

- **Take the entire recurrent core (Part 1) as settled.** It's not controversial; build it.
- **Fork A (write consistency):** evidence leans **additive + deterministic dedup + explicit
  update/delete tool** (mem0's move, safest).
- **Fork B (retrieval):** at our scale, evidence leans **LLM-select over a manifest** (CC), not
  vectors — with BM25 (we have Orama) as a later pre-filter if volume demands.
- **Fork C (overflow):** evidence leans **consolidate-on-overflow + show capacity** (Hermes) over
  silent truncation.
- **Fork D (upkeep):** evidence leans **defer** — additive-accumulate for v1 (mem0), add a
  background distill later (CC/Hermes) only if the store gets noisy.
- **Procedural skills:** powerful but **out of scope** for a first cut; note the anti-poisoning
  rules for if/when we add any auto-extraction.

Plus the two cross-cutting borrowings that cost little and matter a lot: **fence + sanitize
recalled content** (Hermes) since our recalled node text is user-authored, and **a two-store
split** (Hermes' `MEMORY.md`/`USER.md`) mapping to our board vs global memory.

The next document (`agent-context-memory.md` revision) turns these leanings into resolved
decisions with our offline-first / front-end-first constraints applied.
