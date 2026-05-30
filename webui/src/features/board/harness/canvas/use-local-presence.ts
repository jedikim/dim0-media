import { useEffect } from "react"
import { screenToWorld, type CanvasStore } from "@canvas-harness/core"


/**
 * Push local cursor + selection into `store.presence` so peers (via
 * an attached SyncAdapter) see the corresponding remote-cursor /
 * remote-selection overlay.
 *
 * Cursor:
 *   - Tracked from `pointermove` on the canvas wrap, throttled to one
 *     update per ~30ms (matches the lib's repaint cadence; broadcasting
 *     every move would spam the channel).
 *   - Cleared to `null` on `pointerleave` so remote cursors disappear
 *     when the peer's mouse leaves the surface.
 *
 * Selection:
 *   - Subscribed via `store.subscribe('selection', ...)` so any change
 *     forwards immediately. Selection IDs are small arrays; no throttle.
 *
 * Edit-lock semantics (`editing`) land in Phase 4; for the Phase 0
 * spike we only sync cursor + selection.
 */
export const useLocalPresence = (
  store: CanvasStore,
  wrapRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): void => {
  useEffect(() => {
    if (!enabled) return
    const el = wrapRef.current
    if (!el) return

    let lastSent = 0
    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now()
      if (now - lastSent < 30) return
      lastSent = now
      const rect = el.getBoundingClientRect()
      const world = screenToWorld(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        store.getCamera(),
      )
      store.presence.setLocal({ cursor: world })
    }
    const onPointerLeave = () => {
      store.presence.setLocal({ cursor: null })
    }

    el.addEventListener("pointermove", onPointerMove)
    el.addEventListener("pointerleave", onPointerLeave)
    return () => {
      el.removeEventListener("pointermove", onPointerMove)
      el.removeEventListener("pointerleave", onPointerLeave)
    }
  }, [store, wrapRef, enabled])

  useEffect(() => {
    if (!enabled) return
    return store.subscribe("selection", (ids) => {
      store.presence.setLocal({ selection: ids })
    })
  }, [store, enabled])
}
