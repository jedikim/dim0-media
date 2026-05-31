import { useEffect, useRef } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import { loadViewport, saveViewport, viewportScopeKey } from "./viewport-storage"


/**
 * Time to wait after the last camera change before persisting. Picks up
 * where the lib's 150ms motion-end deadline leaves off; long enough to
 * coalesce a multi-burst trackpad pan into one write, short enough that
 * tab-close-after-pan rarely loses the last move.
 */
const DEBOUNCE_MS = 200


/**
 * Per-board camera persistence with near-zero per-frame cost.
 *
 * Strategy: subscribe to the lib's `'camera'` event and debounce-save
 * 200ms after the camera stops moving. Catches pan + zoom + any
 * programmatic `setCamera` (URL deep-link, presentation-mode exit,
 * zoom-reset button) uniformly. Replaces a prior interaction-mode
 * gating approach that missed the Windows / mouse pan path
 * (`panning → marqueeing → idle`) because the marquee gesture
 * intercepts the gesture end before idle.
 *
 * Restore: read the saved camera once after the caller signals
 * `ready` (i.e., after the scene has hydrated) and call
 * `store.setCamera` with the stored value. Skipped silently if no
 * entry exists for this scope.
 *
 * Cleanup flushes any pending save before unsubscribing — covers the
 * pan-then-navigate-fast race where the user moves to another board
 * within the debounce window.
 *
 * Pass `boardId = null` (e.g., between routes) to suspend both restore
 * and save without unmounting.
 */
export const useViewportPersistence = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
  ready: boolean,
): void => {
  const restoredKeyRef = useRef<string | null>(null)

  // Restore once per scope, after hydration completes.
  useEffect(() => {
    if (!boardId || !ready) return
    const key = viewportScopeKey(boardId, rootId)
    if (restoredKeyRef.current === key) return
    const saved = loadViewport(key)
    if (saved) store.setCamera(saved)
    restoredKeyRef.current = key
  }, [store, boardId, rootId, ready])

  // Save the camera after it's been stable for DEBOUNCE_MS.
  useEffect(() => {
    if (!boardId) return
    const key = viewportScopeKey(boardId, rootId)
    let timer: ReturnType<typeof setTimeout> | null = null

    const unsub = store.subscribe("camera", (camera) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => saveViewport(key, camera), DEBOUNCE_MS)
    })

    return () => {
      if (timer) {
        clearTimeout(timer)
        saveViewport(key, store.getCamera())
      }
      unsub()
    }
  }, [store, boardId, rootId])
}
