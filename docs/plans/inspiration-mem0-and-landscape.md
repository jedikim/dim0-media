# Inspiration: mem0 + the 2026 agent-memory landscape

Third study in the series (after `inspiration-claude-code-memory.md` and
`inspiration-hermes-memory.md`). Two parts: (A) a deep-dive on **mem0** — the dedicated
memory *library* (not a full agent), and the simplest of the systems we've looked at — and
(B) a **2026 landscape** of reference memory/context solutions to situate all of it. Ends
with what to take for Dim0. Code cites `~/workspace/mem0/` (mem0ai v2.0.18); landscape claims
cite the sources listed at the end.

---

# Part A — mem0

mem0 is a **memory layer you bolt onto any agent**: `memory.add(messages, user_id=…)` after
each exchange, `memory.search(query, user_id=…)` before the next. It owns extraction, storage,
and retrieval; it is not an agent runtime. That narrow scope is why it's the cleanest thing to
learn the core "extract → store → retrieve" loop from.

## A.0 The headline: mem0 replaced both of its own famous designs

The mem0 pattern cited everywhere — **"extract facts, then have an LLM decide ADD / UPDATE /
DELETE / NOOP against existing memories," backed by a vector store + a Neo4j-style graph** — is
**no longer what the current code does.** In this checkout (v2.0.18):

- The **ADD/UPDATE/DELETE/NOOP decision prompt** (`DEFAULT_UPDATE_MEMORY_PROMPT`) still exists
  in `mem0/configs/prompts.py` but is **dead code** — nothing calls it.
- The **external graph DBs** (Neo4j/Memgraph/Kuzu/Apache AGE) documented in mem0's own
  `AGENTS.md` are **absent from the code** — no `graphs/`, no `graph_memory.py`, no
  `graph_store` config field, no factory.

Both were replaced by a simpler, more deterministic design (corroborated by mem0's own 2026
writeups: *"a recent algorithmic shift… replacing external graph store support with built-in
entity linking"*). **The shift itself is the lesson** — see A.6. Below documents both the
classic pattern (still the widely-cited reference) and what actually ships now.

## A.1 The classic mem0 pattern (the widely-cited reference; now dead code)

Worth knowing because it's what most write-ups mean by "mem0," and it's a clean articulation
of the LLM-mutation approach:

1. **Extract** — `FACT_RETRIEVAL_PROMPT` turns the exchange into a list of atomic facts
   (`{"facts": [...]}`), with the nice guardrail examples (`"Hi." → {"facts": []}`,
   `"There are branches in trees." → {"facts": []}`).
2. **Decide** — for each new fact vs the top-k similar existing memories,
   `DEFAULT_UPDATE_MEMORY_PROMPT` has the LLM emit one of:
   - **ADD** (new info → new id),
   - **UPDATE** (same topic, more info → keep the id, replace text; "keep the fact which has
     the most information"),
   - **DELETE** (the new fact *contradicts* an existing one),
   - **NONE** (already present / irrelevant).
   Anti-hallucination: existing memories are shown with integer ids, and "do not generate any
   new ID" for updates.

That's **two LLM calls per add** (extract, then decide) and the decision loop is what keeps the
store deduped/consistent.

## A.2 What mem0 actually ships now — the additive pipeline

The live `add(infer=True)` path (`mem0/memory/main.py`) is **one LLM call, ADD-only**, with
dedup and consistency handled *deterministically*:

- **Phase 0 — context:** pull the last ~10 messages for this scope (SQLite cache) + the top-10
  semantically-similar existing memories (shown to the LLM with integer ids, never real UUIDs).
- **Phase 2 — extract (1 LLM call):** `ADDITIVE_EXTRACTION_PROMPT` — *"Your sole operation is
  ADD."* The model emits contextually-rich, self-contained facts (15–80 words each), each with
  an optional `linked_memory_ids` array pointing at related existing memories (by UUID). It
  extracts from **both user and assistant** messages. If a new fact is *"semantically
  equivalent to an Existing Memory with no meaningful new context, skip it."*
- **Phase 4/5 — dedup (no LLM):** `md5(text)` hash; collisions with existing or in-batch hashes
  are dropped. **Exact-string only** — reworded-but-equivalent facts accumulate as new,
  *linked*, memories rather than mutating old ones.
- **Phase 6 — persist:** batch insert into the vector store; one `ADD` row in the SQLite
  history table per memory.
- **Phase 7 — entity linking (no LLM):** spaCy NER extracts entities (PERSON/ORG/PRODUCT/etc.,
  deliberately *not* dates/quantities), which are embedded and upserted into a **parallel entity
  vector collection**; each entity row accumulates the `linked_memory_ids` it appears in. This
  is the "graph."

`infer=False` skips the LLM entirely (store messages verbatim). One extra mode:
`procedural_memory` (one summarization call → an agent execution-history memory).

## A.3 The two prompts (the reusable bits)

- **Extraction (live):** *"You are a Memory Extractor — a precise, evidence-bound processor…
  Your sole operation is ADD."* Quality bar worth copying: *"Contextually Rich, Not Atomic /
  Self-Contained / Concise but Complete (15–80 words) / Temporally Grounded / Numerically
  Precise / Preserve Specific Details — Never Generalize."* Output is strict JSON; *"If nothing
  is worth extracting, return {"memory": []}."*
- **Decision (dead, but the reference):** the four-operation manager prompt in A.1. Keep it in
  mind as the *alternative* to additive-plus-dedup.

## A.4 Retrieval — hybrid, no LLM

`search()` is **semantic + BM25 + entity-boost, additively fused** — zero LLM calls (unless an
optional reranker is enabled):

1. embed the query; also lemmatize it and spaCy-extract its entities;
2. **semantic** vector search (over-fetch `max(4×limit, 60)`);
3. **BM25 keyword** search (if the backend supports `keyword_search`; else degrades to
   semantic-only with a warning), normalized through a query-length-adaptive sigmoid;
4. **entity boost**: query entities → entity store → propagate a bounded boost to their
   `linked_memory_ids` (down-weighting entities linked to *many* memories);
5. **fuse**: `combined = min((semantic + bm25 + entity_boost)/max_possible, 1.0)`, with the
   `threshold` gating the *semantic* score *before* fusion;
6. optional **reranker** (Cohere / sentence-transformer / LLM / etc.), off by default, as a
   final pass.

## A.5 Scoping + storage

- **Three-tier scoping:** `user_id` (person) / `agent_id` (AI identity) / `run_id` (session).
  At least one required; **identity keys are stripped from freeform metadata** so a memory can't
  smuggle itself into another scope. Filters are ANDed — `{user_id}` = everything for the user;
  `{user_id, run_id}` = one session. `agent_id`-only triggers agent-perspective extraction.
- **Per-memory payload:** `data` (text), `hash`, `text_lemmatized`, `created_at`/`updated_at`,
  scope ids, optional `role`/`actor_id`/`attributed_to`/`expiration_date`.
- **History/audit:** a SQLite table logging every ADD/UPDATE/DELETE (`old_memory`/`new_memory`)
  — a full mutation trail, exposed via `memory.history(id)`.
- **Pluggability:** uniform factory + Pydantic config for **LLM (~20) / embedder (~13) / vector
  store (25) / reranker (5)**. The entity "graph" inherits the vector-store backend
  automatically (no separate config). Graph store is the one category with no code.

## A.6 Why the shift matters (the design lesson)

mem0 moving from *"LLM decides ADD/UPDATE/DELETE"* to *"additive ADD + deterministic hash dedup
+ accumulate-and-link"* is a bet worth internalizing:

- **An LLM mutation loop is a reliability liability** — a wrong DELETE/UPDATE silently corrupts
  durable state, and it costs a second LLM call per add. Deterministic dedup can't hallucinate a
  destructive edit.
- **Accumulate-and-link over mutate** — contradictions/refinements become *new linked memories*;
  recency + retrieval sort out which wins, and nothing is destroyed. (Compare Zep's "close, never
  delete" temporal edges in Part B — same instinct, different mechanism.)
- **Cost drops** — one LLM call per add, none per search.
- The trade: the store grows and can hold stale/contradictory facts; you lean on retrieval
  ranking (and explicit `update`/`delete` APIs) instead of write-time consistency.

**→ For Dim0:** mem0's shape *is* our L1/L2 minus the vector store. We can adopt the **additive +
deterministic-dedup** pipeline (cheaper, safer) rather than an LLM decision loop, keep an
explicit `update_memory`/`delete_memory` tool for real corrections, and — critically — since our
volumes are small and front-end, we can **skip vectors/BM25/entity-graph entirely** and use
Claude Code's LLM-select-over-manifest for retrieval. mem0 tells us what we *don't* need at our
scale as much as what we do.

---

# Part B — the 2026 agent-memory landscape

Memory is, as of 2026, a first-class architectural component with its own benchmark suite and a
crowded ecosystem. The map:

## B.1 The taxonomy everyone uses

Borrowed from cognitive science, now standard:

- **Working memory** — the live context window (what's in the prompt right now).
- **Episodic** — specific past experiences bound to time/place ("what we did last session"). ≈
  session memory / transcript.
- **Semantic** — atemporal declarative facts ("user prefers X", entity properties). ≈ memdir /
  MEMORY.md / mem0 facts.
- **Procedural** — how to do a class of task. ≈ Hermes skills, mem0 procedural memory.

Most write-ups frame the design problem as **"memory vs context"**: context is the window you
assemble each turn; memory is the durable store you retrieve *into* that window.

## B.2 The named reference systems

| System | Approach | Distinctive idea | License / form |
|---|---|---|---|
| **mem0** | hybrid vector + entity-link, LLM extraction | simplest; additive pipeline (Part A) | OSS library |
| **Zep / Graphiti** | **bi-temporal knowledge graph** | every fact has *valid-time* + *transaction-time*; contradicted facts are **closed, never deleted** → "what was true in March vs now"; incremental, hybrid (semantic+keyword+graph traversal). **LongMemEval leader (~63.8% vs mem0 ~49%)** | OSS + hosted |
| **Letta (MemGPT)** | **OS-inspired self-editing memory** | tiers: **Core** (in-context, char-limited blocks the LLM edits via tool calls) / **Recall** (searchable cache) / **Archival** (long-term); the agent pages memory between tiers itself | OSS + hosted |
| **Cognee** | graph + vector ("cognify" pipeline) | deep knowledge retrieval; Apache-2, nothing gated | OSS |
| **Pinecone / vector DBs** | managed vector recall | fast fuzzy recall as a primitive others build on | hosted |
| research: **Memanto, MemMachine, MOSS, MemGuard** | typed semantic memory / ground-truth-preserving / auditable / contamination-defense | the frontier is *reliability* (auditability, poisoning defense), not just recall | papers |

## B.3 The cross-cutting patterns

1. **Hybrid dual-store** is the dominant production shape: **vector for fuzzy recall + graph for
   entity/temporal queries + an extraction pipeline** turning messages into atomic facts. Many
   add an **episodic buffer** for short-term coherence; the agent routes between them.
2. **LLM extraction into scoped atomic facts** (user / session / agent) is near-universal.
3. **Temporal awareness** is the 2026 differentiator — bi-temporal graphs (Zep) or at least
   dated facts (mem0's temporal grounding, CC's "convert relative → absolute dates").
4. **Async consolidation / "dreaming"** — a background pass between sessions that reviews
   transcripts + memory, merges duplicates, and surfaces insights. **Anthropic shipped a
   "Dreaming" primitive (May 2026)** explicitly modeled on hippocampal consolidation. This is
   the *same idea* as Claude Code's **autoDream** and Hermes' **Curator** — convergent evolution.
5. **Self-editing / self-improving memory** — Letta's tiers and Hermes' skill-review loop both
   let the agent maintain its own store; the frontier concern is **poisoning** (MemGuard;
   Hermes' anti-self-poisoning rules).
6. **Benchmarks exist now:** **LoCoMo** (1,540 Q; single/multi-hop, open-domain, temporal),
   **LongMemEval** (500 Q; 6 categories incl. knowledge-update + temporal), **BEAM**. Use them if
   we ever want to measure.

## B.4 Where our three studied systems sit on this map

- **Claude Code** — file-based **semantic** memory (memdir) + **episodic** (session transcript,
  grep-searchable) + **consolidation** (autoDream). No graph, no vectors; retrieval is
  LLM-select. Curated, human-editable.
- **Hermes** — bounded **semantic** stores (`MEMORY.md`/`USER.md`) + **procedural** (skills) +
  **episodic** (session_search FTS5) + **pluggable providers** (which can bring vector/graph) +
  **consolidation** (Curator). Prompt-cache-obsessed placement.
- **mem0** — **semantic** facts in a hybrid vector+entity store; a *library*, so it's the
  "memory backend" the others (Hermes) can plug in as a provider.

They're complementary lenses: CC and Hermes are *harness* designs (assembly, injection,
compaction, self-improvement); mem0 is a *storage/retrieval* design. Zep/Letta show the two
frontier axes CC/Hermes/mem0 mostly *don't* chase — **temporal graphs** and **agent-managed
tiers**.

---

# Part C — synthesis for Dim0

## C.1 What's convergent across ALL sources (high-confidence for our design)

1. **Separate durable memory from the live context window**, and separate memory-*mechanics*
   (instructions) from memory-*content* (data) at injection time.
2. **Extract atomic, self-contained, scoped facts** (user vs session vs board/agent) — the
   scoping triad is universal (mem0's user/agent/run ≈ our global/agent/board).
3. **Two-tier: a small always-loaded surface + a larger retrieved-on-demand store.** CC's
   index+files, Hermes' bounded block + session_search, mem0's top-k retrieval — same shape.
4. **Ground facts in time** ("47 days old / convert to absolute dates / valid-time") and
   **verify before asserting** — memory is a snapshot.
5. **A background consolidation pass** is now table stakes at the high end (autoDream / Curator /
   Anthropic Dreaming) — but it's a *phase-2* luxury, not v1.
6. **Guard against poisoning** — sanitize/scan recalled content; don't memorize tool-failure
   claims or unresolved-attempt narratives.

## C.2 What mem0 specifically changes in our plan

- **Prefer additive + deterministic dedup over an LLM ADD/UPDATE/DELETE loop.** Cheaper, safer,
  no hallucinated destructive edits. Keep explicit `update`/`delete` tools for real corrections.
  (This resolves the "write path" open decision in `agent-context-memory.md` toward
  *tool-driven additive*, optionally + a stood-down extraction fork.)
- **We can skip the entire vector/BM25/entity-graph stack for v1.** mem0 needs it because it's a
  general-purpose backend at arbitrary scale; our per-board memory is small and lives front-end,
  so **LLM-select-over-a-manifest (Claude Code style) is sufficient** and far less machinery. Add
  a BM25 index (we already have Orama) only if volume demands it.
- **Keep a mutation history/audit** (mem0's SQLite trail) — cheap, and it makes memory
  inspectable/undoable, which fits our offline-first, user-trust posture.
- **The three-tier scope maps directly**: `user_id`→L2 global, `board_id`→L1 board,
  `run_id`→ephemeral session digest.

## C.3 The one-paragraph takeaway

Across Claude Code, Hermes, mem0, and the 2026 field, the durable core is the same: **extract
scoped atomic facts, keep a small always-on surface + a retrieved-on-demand store, ground facts
in time, and consolidate in the background.** The live disagreements are *how* to keep the store
consistent (LLM mutation loop → losing ground to additive+dedup and temporal "close-don't-delete")
and *how* to retrieve (vectors+graph vs LLM-select — and at our scale, LLM-select wins on
simplicity). For Dim0 that argues for a **deliberately minimal v1**: a two-store curated memory
(board + global), additive writes with deterministic dedup and an audit trail, LLM-select
retrieval over a fenced manifest, a labeled board snapshot — and consolidation/temporal/graph
deferred until we have volume that demands them.

---

## Sources (2026 landscape)

- Vectorize — *Best AI Agent Memory Systems in 2026: 8 Frameworks Compared*
- mem0.ai — *State of AI Agent Memory 2026*; *AI Memory Benchmarks 2026: LoCoMo, LongMemEval & BEAM*; *Graph-Based Memory Solutions*
- n1n.ai / particula.tech / developersdigest — *Mem0 vs Zep vs Letta vs Cognee (2026)*
- Zep/Graphiti + Letta/MemGPT explainers (gamgee.ai, codepointer, theaiengineer)
- arXiv 2026: Memanto (typed semantic memory), MemMachine, MOSS (auditable memory), MemGuard (contamination defense)
- Anthropic "Dreaming" consolidation primitive (May 2026), per landscape coverage

(Cross-check any specific number against the primary source before quoting it externally — these
are secondary write-ups.)
