# Dim0 — Features

What the product does, one entry per feature, with the code entry point. Wiring/invariants are in [`architecture.md`](./architecture.md).

## Infinite canvas (board)

The core surface: an infinite, zoomable whiteboard of typed nodes rendered by the in-house `@canvas-harness` engine. Node types beyond notes: **folder** (nested boards — double-click navigates into a sub-layer via `root_id`), **sheet** (long-form TipTap docs), **code-sandbox**, **mini-app**, **document**, and legacy **widget**. Rich surfaces open in a modal host with their own URL. Entry: `webui/src/features/board/harness/`.

## Board-aware AI agent

A chat agent that reads the current board (and selection) and writes results back as editable nodes/links. Multi-step tool use: create/edit/link notes, web search, fetch a URL, run code, search memory, generate mini-apps, mindmap/diagram/summarize/quiz. Two runtimes (see architecture): the browser engine (current) and the server-side OpenAI-Agents agent (legacy). Entries: `webui/src/features/agent/engine/agent-loop.ts`, `backend/topix/agents/assistant/`.

## Real-time collaboration & sharing

Multiplayer boards over WebSocket with live cursors/presence; server-sequenced last-writer-wins. Share links (`member`/`viewer`, upgrade-only, reusable until revoked) with a pre-auth preview landing. Entries: `backend/topix/api/router/collab.py`, `backend/topix/sharing/`, `webui/src/features/board/harness/sync/`.

## Offline-first / local boards

Boards work with no account, persist to IndexedDB, and are fully usable offline (`/local`). "Enable sync" promotes a local board to a synced one **in place** (same id) via `POST /boards/{id}:adopt`, without losing edits made during promotion. Entries: `webui/src/features/board/persist/local/`, `harness/sync/enable-sync.ts`.

## Mini-apps

The agent authors real interactive React (JSX) that runs as a node: sucrase-compiled and mounted in a **sandboxed iframe**, with a minimal `postMessage` RPC (`initialState`/`saveState`/`toast`). Security is the iframe sandbox + origin split, not the compiler. Entries: `webui/mini-app-runtime/` (iframe), `webui/src/features/mini-app/` (host), `backend/topix/mini_app/compile.py` (validation).

## Document Q&A

Upload a PDF, ask grounded questions. OCR'd online (Mistral via `/ai/parse`), then chunked + indexed **offline** (per-board Orama BM25, no vector store), retrieved by a `doc_search` tool with per-answer citations. Entries: `webui/src/features/agent/engine/doc-{parse,chunk,search}.ts`, `features/board/search/doc-index.ts`.

## Multi-model, BYOK-or-managed

Bring your own key (OpenAI, or OpenRouter → Claude/Gemini/etc.) or use managed models on our keys with per-plan tiers and `auto` routing. Each capability (LLM/search/code/fetch/parse) resolves independently to BYOK, managed, or off. Entries: `webui/src/features/agent/engine/services/`, `backend/topix/api/router/ai.py`.

## AI image generation history

Synced boards can generate audited images through server-side providers. Every authenticated Dim0 user can open `AI image history` to inspect all creators' prompts, private board labels, ordered reference originals, generated results, lifecycle state, and provider-reported cost/usage. The history is read-only and intentionally has no per-record opt-out or deletion control. Entries: `backend/topix/api/router/{image_generation,image_history}.py`, `webui/src/features/image-history/`.

## Built-in widgets, newsfeed, code sandbox

Non-agent widgets (weather, stock/trading charts). A newsletter/subscription "newsfeed" feature (topic tracking) separate from boards. Daytona-backed code execution (`python`/`javascript`, network-blocked, ephemeral). Entries: `webui/src/features/widgets/`, `newsfeed/`, `backend/topix/agents/assistant/code.py`.

## Accounts, billing, self-host

Email + Google sign-in, email verification, password reset. Three tiers `free | basic | plus` (JWT `plan` claim), Stripe-backed, flag-gated (`BILLING_ENABLED`, default off → self-host unlocks `plus`). MIT-licensed, self-hostable via Docker (needs at least one LLM provider key; see `.env.sample`). Entries: `webui/src/features/signin/`, `user-settings/`, `backend/topix/api/router/{users,billing,subscriptions}.py`.
