import { useRouterState } from "@tanstack/react-router"


/**
 * True on the local-first board route (`/local/...`), where there is no backend.
 *
 * Backend-only AI affordances — the answer-card transforms (Notify/Mapify/
 * Schemify) and the canvas context-menu AI section (summarize/mapify/schemify/
 * quizify/drawify/explain/translate) — call `/tools/*` and would fail here, so
 * they gate off on local until ported to the in-browser engine.
 * See agent-runtime-migration.md (§ transforms).
 */
export const useIsLocalBoard = (): boolean =>
  useRouterState({ select: (s) => s.location.pathname.startsWith("/local") })
