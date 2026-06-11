// Host-side client for per-user mini-app widget state.
//
// Thin wrappers around the backend's /mini-app-state endpoints. Used
// by MiniAppMount (Phase 3) to hydrate the iframe's host.initialState
// and to persist whatever the widget passes to host.saveState.
//
// The shape of `state` is anything the widget JSON-serializes — we
// don't validate it here; the backend stores it as opaque JSONB.

import { apiFetch } from "@/api"


interface MiniAppStateResponse {
  status: "success" | "error"
  data?: { state: unknown }
}


/**
 * Fetch the saved state for the current user on the given note.
 *
 * Returns the stored value (which itself may be any JSON, including
 * ``null``) or ``undefined`` when no row exists yet.
 */
export async function fetchMiniAppState(noteId: string): Promise<unknown> {
  const response = await apiFetch<MiniAppStateResponse>({
    path: `/mini-app-state/${encodeURIComponent(noteId)}`,
    method: "GET",
  })
  if (response.status !== "success" || !response.data) return undefined
  return response.data.state ?? undefined
}


/**
 * Persist the given state for the current user on the given note.
 *
 * Overwrites any previous value — widget state has no history in v1.
 */
export async function saveMiniAppState(
  noteId: string,
  state: unknown,
): Promise<void> {
  await apiFetch({
    path: `/mini-app-state/${encodeURIComponent(noteId)}`,
    method: "PUT",
    body: { state },
  })
}
