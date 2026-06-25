# Proposal: Simplified model catalog so Dim0 runs on minimal API keys

**Status:** implemented (branch `feat/model-catalog-minimal-keys`), for review

## Implementation status (what landed)

- **Step 1 — catalog + resolver:** `backend/topix/models.yml` (providers + `llm` + `embedding`, route-based) and `backend/topix/config/catalog.py` (`resolve` / `available_llms` / `available_embedding` / `resolve_code` / `normalize_code` / `default_model_code` / `default_resolved`). `config/services.py` now sources LLMs + provider availability from the catalog; `services.yml` keeps only search/navigate/code/image. Unit tests in `test/unit/config/test_catalog.py` (9, passing).
- **Step 2 — auto-model + no hardcoded providers:** `manager.py` picks tier-based models from the catalog; `auto_model.py` classifier uses the best available lite model (OpenAI or OpenRouter client); `agents/config.py:validate_model` and `BaseAgent.__post_init__` route every model string through `normalize_code` (this transparently fixes the ~7 aux agents that defaulted to `ModelEnum.OpenAI.*`). YAML configs switched to canonical ids; deep-research auto default de-hardcoded in `chats.py`.
- **Step 3 — embeddings via routes:** `nlp/embed.py` resolves its provider (OpenAI native or OpenRouter base_url) from `catalog.available_embedding()`. Vector dim stays 512 (same model on both routes), so Qdrant wiring is untouched.
- **Step 4 — navigate no hard-fail:** already satisfied — `AssistantManagerConfig.from_yaml` guards disable navigate/code/image to `None` when no provider, so nothing raises. The keyless/Linkup fetch remains a separate follow-up PR.
- **Step 5 — key-aware default tools:** `chat-store.ts:syncDefaults` already gated default `enabledTools` on availability; the only gap fixed was the image-gen toggle, now disabled when OpenRouter is absent (matching code-interpreter).
- **Step 6 — dynamic model list:** `/utils/services` returns full model objects (`id`/`label`/`family`/`tier`/`provider`); frontend `llm.ts` dropped the hardcoded `LlmModels`/`LlmName`/`LlmFamilyMap`/… in favor of backend-driven rendering (`familyIcon`/`familyLabel` with fallbacks), `LlmModel` relaxed to `string`, picker groups by backend `family`.

Verified: catalog resolves correctly for OpenAI-only / OpenRouter-only / multi-key / no-key; backend `529 + 9` unit tests pass; frontend `tsc` + `eslint` clean.

---


**Goal:** Let a self-hoster run Dim0 with just **OpenAI + Linkup** *or* **OpenRouter + Linkup** and have everything "just work" — chat, embeddings/memory, auto-model, web search, and URL fetch — with the model list auto-syncing to whatever keys are present.

This proposal covers **only the API-key painpoint**. The infra painpoint (Postgres + Qdrant + Redis) is out of scope.

---

## 1. Problem

Today a working deploy effectively needs **OpenAI + OpenRouter + Linkup**, because three things are wired to specific providers:

1. **Embeddings are hard-pinned to OpenAI.** `nlp/embed.py` has one embedder (`OpenAIEmbedder`, `text-embedding-3-small`, 512-dim), instantiated unconditionally. Every note write and chat message embeds (via `store/graph.py`, `store/chat.py` → Qdrant); `memory_search` embeds the query. There is no fallback. → "OpenRouter + Linkup, no OpenAI" breaks on the **first note write**.

2. **Auto-model is hardcoded to specific providers.** `agents/assistant/manager.py`:
   ```python
   AUTO_MODEL_BASE_PLAN    = "openrouter/deepseek/deepseek-v4-flash:nitro"   # needs OpenRouter
   AUTO_MODEL_COMPLEX_PLAN = ModelEnum.OpenAI.GPT_5_4                        # needs OpenAI
   ```
   The complexity classifier (`agents/assistant/auto_model.py`) also calls a hardcoded OpenRouter model. → Auto-model silently assumes **both** keys exist. OpenAI-only breaks the base plan; OpenRouter-only breaks the complex plan.

3. **Navigate (fetch URL) hard-requires Tavily.** `agents/websearch/fetch.py` → `tools.py` calls `https://api.tavily.com/extract`, and the config validator (`agents/config.py:~86`) raises if no navigate provider is present. Neither target key-set includes Tavily. → Even "OpenAI + Linkup" trips this.

A secondary issue: the **data structure** for models is flat and bakes in exactly two routes per model (`model` = native, `openrouter_model` = the single fallback). It can't cleanly express "this model is reachable through N providers, each with a slightly different string name," and it makes OpenRouter a special case rather than just another provider.

### What already works (don't rebuild)

- `config/services.py:_sync()` already filters providers by `os.getenv(env_var)` — only providers with a key load.
- The OpenRouter fallback already exists (`_get_llm_services`, ~line 174): missing native key + present `OPENROUTER_API_KEY` ⇒ model kept with `use_openrouter=True`, `code` becomes `openrouter/<openrouter_model>`.
- `GET /utils/services` (`api/router/utils.py:69-80`) already returns the key-filtered list.
- The frontend already overlays availability and gates unavailable models with a lock icon.
- **OpenRouter now supports embeddings** (2026): `POST /api/v1/embeddings`, OpenAI-compatible, exposing `text-embedding-3-*`, Gemini Embedding, Qwen, etc. ⇒ embeddings can use the same routing as chat; no local embedder required.

---

## 2. Core idea: separate the *model* from the *route*

Model the catalog as **canonical model → ordered list of routes**, with a small **provider registry** that owns the key + call convention. One resolver turns `(catalog, keys-present)` into a flat list of available models. That single list feeds every consumer.

This directly answers "which provider, and what string on that provider": the per-provider string lives in the route; the resolver just prepends the provider prefix.

### New file: `backend/topix/models.yml`

Replaces `llm_models.yml` and folds the provider→env-var map in from `services.yml`.

```yaml
providers:
  openai:     { key: OPENAI_API_KEY,     prefix: openai }
  openrouter: { key: OPENROUTER_API_KEY, prefix: openrouter }
  anthropic:  { key: ANTHROPIC_API_KEY,  prefix: anthropic }
  gemini:     { key: GEMINI_API_KEY,     prefix: gemini }
  mistral:    { key: MISTRAL_API_KEY,    prefix: mistral }
  deepseek:   { key: DEEPSEEK_API_KEY,   prefix: deepseek }

llm:
  - id: gpt-5.4              # stable id used by API + frontend; never changes
    name: GPT-5.4
    family: openai           # icon / grouping
    tier: pro                # consumed by auto-model
    routes:                  # preferred first
      - { via: openai,     name: gpt-5.4 }
      - { via: openrouter, name: openai/gpt-5.4 }

  - id: gpt-5.4-mini
    name: GPT-5.4 Mini
    family: openai
    tier: lite
    routes:
      - { via: openai,     name: gpt-5.4-mini }
      - { via: openrouter, name: openai/gpt-5.4-mini }

  - id: claude-opus-4.6
    name: Claude Opus 4.6
    family: anthropic
    tier: pro
    routes:
      - { via: anthropic,  name: claude-opus-4-6 }
      - { via: openrouter, name: anthropic/claude-opus-4.6 }

embedding:
  - id: text-embedding-3-small
    dim: 512                 # routes under one id MUST share dim (vector compatibility)
    routes:
      - { via: openai,     name: text-embedding-3-small }
      - { via: openrouter, name: openai/text-embedding-3-small }
```

Adding/removing a model = one YAML entry. No code change.

### New file: `backend/topix/config/catalog.py` (~40 lines)

```python
@dataclass
class Resolved:
    id: str
    name: str
    family: str
    tier: str            # "pro" | "lite" (llm only)
    provider: str        # the chosen route's provider
    call: str            # what base.py/embedder uses: "openrouter/anthropic/claude-opus-4.6"
    dim: int | None = None   # embedding only
    available: bool = True


def resolve(model) -> Resolved | None:
    """First route whose provider key is present wins; None means hidden."""
    for r in model.routes:
        p = providers[r.via]
        if os.getenv(p.key):
            return Resolved(**model.meta, provider=r.via,
                            call=f"{p.prefix}/{r.name}", dim=getattr(model, "dim", None))
    return None


def available_llms() -> list[Resolved]:
    return [r for m in catalog.llm if (r := resolve(m))]


def available_embedding() -> Resolved | None:
    for m in catalog.embedding:
        if (r := resolve(m)):
            return r
    return None
```

`call` is exactly the format `agents/base.py:58-63` already consumes (`openai/...` → native OpenAI client; anything else → `LitellmModel`). The OpenRouter embeddings route uses the same OpenAI SDK with `base_url=https://openrouter.ai/api/v1`.

**Resolved object shape returned to all consumers:**
```jsonc
{ "id": "claude-opus-4.6", "name": "Claude Opus 4.6", "family": "anthropic",
  "tier": "pro", "provider": "openrouter",
  "call": "openrouter/anthropic/claude-opus-4.6", "available": true }
```

---

## 3. Changes — 6 small, sequenced steps

### Step 1 — Catalog + resolver (foundation)
- **Add** `backend/topix/models.yml`, `backend/topix/config/catalog.py`.
- **Migrate** `llm_models.yml` → `models.yml` mechanically (see §4).
- **Rewire** `config/services.py` so `service_config.llm` is backed by `available_llms()`. Keep `services.yml`'s `search` / `navigate` / `code` / `image_generation` sections as-is — **do not** unify those (not worth the churn).
- `agents/config.py:validate_model` keeps working: it validates against `service_config.llm` and falls back to the first available — unchanged behavior, new backing list.

### Step 2 — Auto-model stops hardcoding (`agents/assistant/manager.py`)
- Replace the two `AUTO_MODEL_*` constants with selection from `available_llms()`:
  - `smart = first model with tier == "pro"`
  - `fast  = first model with tier == "lite"`  (catalog order = preference)
  - classifier (`auto_model.py`) reuses `fast` instead of its hardcoded OpenRouter model; if no lite model exists, skip classification and default to `smart`.
- Result: auto-model works on OpenAI-only **or** OpenRouter-only.

### Step 3 — Embeddings via routes (`nlp/embed.py`, Qdrant setup)
- `Embedder` resolves its route from `available_embedding()`:
  - provider `openai` → native `AsyncOpenAI`.
  - provider `openrouter` → `AsyncOpenAI(base_url="https://openrouter.ai/api/v1", api_key=OPENROUTER_API_KEY)` (OpenAI-compatible embeddings endpoint).
- Drive the Qdrant collection vector size from the resolved `dim` (`store/qdrant/setup.py` / `store.py`) instead of the hardcoded 512.
- **Constraint to document:** the embedding model is fixed per deployment. Switching providers for the *same* id (openai ↔ openrouter, both 512) is safe; switching to a different id/dim requires a re-index. This is fine for fresh OSS deploys.
- **Unlocks "OpenRouter + Linkup, no OpenAI."**

### Step 4 — Navigate: stop hard-failing (`agents/config.py`)
Scope here is **only** removing the hard requirement; the actual fetch revamp is a separate PR (see §5).
- Relax the navigate validator (`agents/config.py:~86`) so a missing Tavily key no longer raises. With no navigate provider, `navigate` resolves as unavailable and the tool is simply disabled — exactly like `code` / `image_generation` already degrade.
- Net effect for minimal-key deploys: the app **runs**; URL-fetch is just off until the follow-up PR adds a keyless / Linkup fetch.

### Step 5 — Key-aware default tools (`features/agent/store/chat-store.ts`)
Today the frontend seeds a fixed `enabledTools` list (`chat-store.ts:47-63`) with *every* tool on, regardless of whether its backing service has a key; some toggles (e.g. image-gen) don't even check availability. Make defaults follow availability, reusing the same `/utils/services` data the model picker already consumes.
- In `syncDefaults` (`chat-store.ts:87-142`), a tool is **default-enabled only if its service resolves**:
  - `web_search` → only if `services.search` non-empty (engine defaults to first available)
  - `code_interpreter` → only if `services.code[0].available` (Daytona)
  - `image_generation` → only if `services.image_generation[0].available` (OpenRouter)
  - `navigate` → only if `services.navigate` non-empty
  - `memory_search` → board-scoped (already)
  - board tools (`write_note` / `edit_note` / `get_note` / `link_notes`) and keyless widgets (`display_*`, `learn_*`) → always on
- Every tool toggle shows a lock/disabled state when unavailable (the model picker already does this; bring the image-gen toggle in line — it currently skips the check, per the TODO in `image-gen.tsx`).
- Backend already wires tools conditionally; this just stops the UI from defaulting-on tools that can't run.

### Step 6 — Frontend dynamic model list (`features/agent`)
- **Backend:** extend `GET /utils/services` (or add `/models`) to return the full Resolved objects (`id`, `name`, `family`, `tier`, `available`) rather than just `code` strings.
- **Frontend:**
  - Drop the hardcoded `LlmModels` union (`types/llm.ts:14-44`) and the parallel `LlmName` / `LlmDescription` maps; render whatever the backend returns, grouped by `family`.
  - Relax `LlmModel` type from a string-literal union → `string`.
  - Keep `LlmFamilyIcon` (`types/llm.ts:~196-206`) as a brand-icon lookup with a **generic fallback** for unknown families.
  - Availability gating (lock icons), provider grouping, storage, and request transmission already work — no change.
  - Optional: activate the already-defined-but-unused tier badges.

---

## 4. Migration (mechanical)

For each entry in `llm_models.yml`:
- native route ← `{ via: <provider>, name: <model> }`
- if `openrouter_model` present ← add `{ via: openrouter, name: <openrouter_model> }`
- if absent but OR fallback desired ← `{ via: openrouter, name: "<provider>/<model>" }` (mirrors today's `self.openrouter_model or f"{provider}/{model}"`).

`tier` already exists on every entry — it just starts being *used* (Step 2). Provider→env-var map moves from `services.yml` into `models.yml`'s `providers` block.

---

## 5. Explicitly out of scope (keep it simple)

- **Web-search / fetch revamp** — a keyless `httpx` + readability fetch *and* a Linkup-based fetch are a **separate follow-up PR** that reworks the web-search/fetch tools. This PR only stops `navigate` from hard-failing (Step 4) so minimal-key deploys boot; it does not implement a new fetch path.
- **Local/ONNX embedder** — unnecessary now that OpenRouter serves embeddings. Add later only if someone wants fully keyless RAG.
- **Unifying search/navigate/code/image into the routes catalog** — they stay on their current simpler config; only `llm` + `embedding` use routes.
- **Live provider `/models` auto-discovery** — curated catalog stays the source of truth. A `make models-sync` dev script that validates each route's `name` against provider `/models` endpoints (and LiteLLM's built-in name map) can come later as a maintenance aid, not a runtime mechanism.

---

## 6. Result

| Keys present | Chat | Embeddings / memory | Auto-model | Web search | Navigate |
|---|---|---|---|---|---|
| **OpenAI + Linkup** | OpenAI native | OpenAI | OpenAI tiers | Linkup | off unless Tavily set¹ |
| **OpenRouter + Linkup** | all via OpenRouter | via OpenRouter | OpenRouter tiers | Linkup | off unless Tavily set¹ |
| OpenAI + OpenRouter + Linkup (today) | both | OpenAI | both | Linkup | Tavily |

¹ `navigate` no longer hard-fails; it's just disabled when no fetch provider is configured. The follow-up web-search/fetch PR adds a keyless / Linkup fetch so it works with zero extra keys.

Steps 1–3 make it **run** on minimal keys (the core goal). Step 4 removes the last hard-fail. Step 5 makes tool defaults honest about what's actually available. Step 6 delivers the auto-sync model UX.

---

## 7. Open questions

1. **Embedding default** — confirm: route through `openai` then `openrouter`, no local fallback for v1? (Recommended: yes.)
2. **Provider env-var names** — `.env.sample` currently has `MISTRAL_API_KEY` but `services.yml` references `MISTRALAI_API_KEY`; standardize when moving into `models.yml`.
3. **`/models` vs extend `/utils/services`** — add a dedicated endpoint or widen the existing one? (Recommended: widen existing to avoid a new route + frontend fetch.)
4. **Image generation** with OpenAI-only — leave disabled (OpenRouter-only feature), or add an OpenAI image route? (Recommended: leave disabled for v1.)

---

## 8. Key file references

| Concern | File | Notes |
|---|---|---|
| Static model list | `backend/topix/llm_models.yml` | → replaced by `models.yml` |
| Provider env-var map, llm filtering, OR fallback | `backend/topix/config/services.py` (`_sync` ~98–148, `_get_llm_services` ~150–182, `LLMService.code` ~54–61) | rewire to `catalog.py` |
| Model → agent instantiation | `backend/topix/agents/base.py:58-63` | consumes `call` unchanged |
| Model validation/fallback | `backend/topix/agents/config.py:37-49` | unchanged behavior |
| Auto-model hardcoded picks | `backend/topix/agents/assistant/manager.py` (~37–38, ~109–119) | Step 2 |
| Complexity classifier | `backend/topix/agents/assistant/auto_model.py` | Step 2 |
| Embedder (OpenAI-pinned) | `backend/topix/nlp/embed.py:14-24` | Step 3 |
| Qdrant collection dim | `backend/topix/store/qdrant/setup.py`, `store/qdrant/store.py` (~87) | Step 3 |
| Navigate hard-fail validator | `agents/config.py:~86` | Step 4 (fetch impl deferred to follow-up PR) |
| Frontend tool defaults | `webui/src/features/agent/store/chat-store.ts` (defaults ~47–63, `syncDefaults` ~87–142) | Step 5 |
| Per-tool toggles (incl. image-gen TODO) | `webui/src/features/agent/components/chat/input-settings/` | Step 5 |
| Services endpoint | `backend/topix/api/router/utils.py:69-80` | Step 6 |
| Frontend hardcoded model list | `webui/src/features/agent/types/llm.ts:14-44`, family icons ~196–206 | Step 6 |
| Frontend availability overlay | `webui/src/features/agent/api/list-available-services.ts:26-70` | Step 6 |
| Model picker UI | `webui/src/features/agent/components/chat/input-settings/model-card.tsx:68-178` | Step 6 |
