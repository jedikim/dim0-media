# webui — Frontend conventions

Applies to `webui/**`. Repo-wide rules (commits, docstrings) are in the root `AGENTS.md`; architecture is in `docs/architecture.md`.

## Code style

- TypeScript only (`.ts` / `.tsx`), never plain JavaScript.
- No semicolons.
- No `export default` for React/components — use named exports.
- No `any` — prefer explicit types, `unknown`, generics, or narrow unions.
- 2 blank lines between top-level declarations; 1 blank line inside blocks.
- Run `npm run check-all` (type-check + eslint) before pushing.

## Stack

React 19, Vite 7, Tailwind v4, TanStack Router + Query, Zustand, Phosphor icons. The canvas engine is the `@canvas-harness/*` npm dependency (not in-tree). Client search via Orama; IndexedDB via `idb`.

## Orientation (detail in `docs/architecture.md`)

- Two agent runtimes behind one chat UI, chosen by `local`: the browser engine (`features/agent/engine/`) and the legacy server path (`features/agent/api/send-message.ts`, retires in G5).
- Working in `features/agent/engine/`? Off-board tools + the tool-failure contract are load-bearing — see `docs/adr/ADR-AGENT-002`. Browser-agent transcript storage → `docs/adr/ADR-AGENT-001`. Service resolution (BYOK/managed/off) + per-run metering → `docs/adr/ADR-AGENT-003`. Local doc Q&A (BM25, no vectors) → `docs/adr/ADR-SEARCH-001`.
- Board = the canvas-harness mount at `features/board/harness/canvas/harness-canvas.tsx`; Dim0 `Note`/`Link` ↔ harness `Node`/`Edge` in `harness/convert/`; offline-first persistence in `features/board/persist/local/`.
- Working in `harness/sync/` or `persist/local/`? The client owns conflict resolution; the backend is a sequencer + relay — see `docs/adr/ADR-SYNC-001` and the schema/invariants in `docs/offline-first-data-model.md`.
- `_storedColors` (not `node.style`) is the color source of truth.
- Signed-out sentinel is `userId === "root"` (non-empty) — gate on `isSignedIn()`, never `!!userId`.
