## Commit Rules
- Use Conventional Commit / Commitizen format: `type(scope): message`.
- Scope is mandatory and specific (e.g., `agent`, `webui`, `backend`, `prompts`).
- Keep message short, imperative, lowercase (no trailing period).
- One commit should represent one logical change.

## Repo Map
- `backend/`: API, assistant agents, prompts, model/service configs.
- `webui/`: frontend app (routes, features, components, stores, styles).
- `build/`: generated/build artifacts.

## Core Features
- `webui` has two core domains:
  - `agent/`: chat input flow, streaming lifecycle, tool-call rendering, assistant UX.
  - `board/`: whiteboard workspace for visual note organization.
- `board` is a core product surface:
  - Store: `webui/src/features/board/store/graph-store.ts`
  - Main editor: `webui/src/features/board/components/flow/graph-editor.tsx`
  - Node rendering: `webui/src/features/board/components/flow/node-view.tsx`, `webui/src/features/board/components/flow/note-card.tsx`, `webui/src/features/board/components/flow/shapes.tsx`

## Frontend Code Style
- Use TypeScript for frontend code (`.ts` / `.tsx`), not plain JavaScript.
- Do not use semicolons.
- Do not use `export default` for React/components; use named exports.
- Do not use `any`; prefer explicit types, `unknown`, generics, or narrow unions.
- Use 2 blank lines between top-level declarations; use 1 blank line inside blocks.

## Docstrings
- Add a short, comprehensible docstring for new or modified functions, methods, and classes.
- Focus on intent and behavior (what it does, key inputs/outputs), not line-by-line implementation details.
- Keep docstrings concise (1-3 lines by default; expand only for non-obvious logic).
- Skip trivial/redundant comments when the code is already self-explanatory.