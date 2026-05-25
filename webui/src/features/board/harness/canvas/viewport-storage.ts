import type { CameraState } from "@canvas-harness/core"


/**
 * localStorage-backed per-board camera persistence.
 *
 * Reuses the same storage key + shape as dim0's react-flow viewport-store
 * (`topix:graph-viewports`, `Record<scopeKey, { x, y, zoom }>`) so
 * users keep their saved viewports across the canvas-harness migration.
 *
 * canvas-harness CameraState is `{ x, y, z }` — `z` ↔ `zoom` translation
 * happens at the storage boundary.
 */


const STORAGE_KEY = "topix:graph-viewports"


type StoredViewport = { x: number; y: number; zoom: number }


type StoredViewports = Record<string, StoredViewport>


/** Build the per-board key. Matches dim0's `${boardId}:${rootId ?? ""}`. */
export const viewportScopeKey = (boardId: string, rootId?: string | null): string =>
  `${boardId}:${rootId ?? ""}`


const getStorage = (): Storage | null =>
  typeof window !== "undefined" ? window.localStorage : null


const safeParse = (raw: string | null): StoredViewports => {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as StoredViewports
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}


/** Load the saved camera for a given scope, or `null` if none saved. */
export const loadViewport = (scopeKey: string): CameraState | null => {
  const storage = getStorage()
  if (!storage) return null
  const all = safeParse(storage.getItem(STORAGE_KEY))
  const vp = all[scopeKey]
  if (!vp) return null
  return { x: vp.x, y: vp.y, z: vp.zoom }
}


/** Persist the camera for a given scope. Merges into the existing map. */
export const saveViewport = (scopeKey: string, camera: CameraState): void => {
  const storage = getStorage()
  if (!storage) return
  const existing = safeParse(storage.getItem(STORAGE_KEY))
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...existing,
      [scopeKey]: { x: camera.x, y: camera.y, zoom: camera.z },
    }),
  )
}
