## Commit Rules
- Use Conventional Commit / Commitizen format: `type(scope): message`.
- Scope is mandatory and specific (e.g., `agent`, `webui`, `backend`, `prompts`).
- Keep message short, imperative, lowercase (no trailing period).
- One commit should represent one logical change.

## Repo Map
- `backend/`: FastAPI service (package `topix`) — API, assistant agents, prompts, model/service configs.
- `webui/`: frontend SPA — routes, features (`agent/` + `board/`), components, stores, styles.
- `build/`: Docker Compose + `schema.sql`.
- `docs/`: architecture, features, roadmap (see Docs map below).
- Note: `@canvas-harness/*` is an npm **dependency**, not in-tree source.

## Domain conventions
Conventions live with the code they govern (loaded on demand when you work in that tree):
- Frontend code style + FE orientation → `webui/AGENTS.md`
- Python conventions + backend orientation → `backend/AGENTS.md`

## Docs map (read on demand)
- Code structure & key invariants → `docs/architecture.md`
- What the product does, feature by feature → `docs/features.md`
- In-flight work & known follow-ups → `docs/roadmap.md`
- Durable decisions (MUST/why, one per file) → `docs/adr/` (index in `docs/adr/README.md`)

## Core Features
- `webui` has two core domains:
  - `agent/`: chat input flow, streaming lifecycle, tool-call rendering, assistant UX. Two runtimes (browser engine + legacy server path).
  - `board/`: whiteboard workspace for visual note organization. Rendered by canvas-harness.
- `board` lives under `webui/src/features/board/harness/`:
  - Mount: `harness/canvas/harness-canvas.tsx` — wires the lib `<Canvas>` to Dim0 state.
  - Convert layer (Dim0 Note/Link ↔ harness Node/Edge): `harness/convert/`.
  - Custom node-type views: `harness/node-types/`.
  - Collab: `harness/sync/board-sync.ts` (v2 offline-first) / `harness/canvas/use-ws-collab.ts` (legacy) ⇄ `backend/topix/collab/`.

## Tech Stack
- Frontend: React + TypeScript, Vite, Tailwind v4, Tanstack Router, Zustand, Phosphor icons.
- Canvas engine: in-house `@canvas-harness/core` + `@canvas-harness/react` npm packages.
- Backend: FastAPI (Python), Pydantic, Postgres, Qdrant, Redis, WebSocket collab.

## Docstrings
- Add a short, comprehensible docstring for new or modified functions, methods, and classes.
- Focus on intent and behavior (what it does, key inputs/outputs), not line-by-line implementation details.
- Keep docstrings concise (1-3 lines by default; expand only for non-obvious logic).
- Skip trivial/redundant comments when the code is already self-explanatory.
