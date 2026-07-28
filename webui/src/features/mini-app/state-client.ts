// Host-side client for per-note mini-app widget state — thin wrappers over the
// shared `MiniAppRepo`.
//
// Local-first: state lives in IndexedDB (the `mini_app_state` store), the local
// analog of the backend's /mini-app-state endpoints. Used by MiniAppMount to
// hydrate the iframe's host.initialState and to persist whatever the widget
// passes to host.saveState. Backed by the app-wide engine from the composition
// root (one shared connection).

import { getLocalStores } from "@/features/local-stores"


/**
 * Fetch the saved state for the given note. Returns the stored value (which may
 * itself be any JSON, including ``null``) or ``undefined`` when none exists.
 */
export async function fetchMiniAppState(noteId: string): Promise<unknown> {
  return (await getLocalStores()).miniApps.getState(noteId)
}


/**
 * Persist the given state for the note. Overwrites any previous value — widget
 * state has no history in v1.
 */
export async function saveMiniAppState(noteId: string, state: unknown): Promise<void> {
  await (await getLocalStores()).miniApps.putState(noteId, state)
}
