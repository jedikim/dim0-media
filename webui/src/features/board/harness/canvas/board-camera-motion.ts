import { useCallback, useEffect, useSyncExternalStore } from "react"
import type { CanvasStore } from "@canvas-harness/core"


// The camera counts as "at rest" this long after its last change. Mirrors the
// lib's ~150ms motion-end deadline that useViewportPersistence also builds on.
const QUIET_MS = 150


type MotionEntry = { atRest: boolean; listeners: Set<() => void> }

// Per-board (per CanvasStore) motion state — NOT a module singleton — so two
// HarnessCanvas instances overlapping during a route transition can't clobber
// each other's atRest. WeakMap so entries drop with their store.
const entries = new WeakMap<CanvasStore, MotionEntry>()


function getEntry(store: CanvasStore): MotionEntry {
  let e = entries.get(store)
  if (!e) {
    e = { atRest: true, listeners: new Set() }
    entries.set(store, e)
  }
  return e
}


function setAtRest(e: MotionEntry, atRest: boolean): void {
  if (e.atRest === atRest) return
  e.atRest = atRest
  for (const l of e.listeners) l()
}


/**
 * Install ONCE per board (in HarnessCanvas): tracks whether THIS board's camera
 * has been at rest for QUIET_MS. Subscribes to the lib's `'camera'` event and
 * debounces — the same approach useViewportPersistence uses, because the
 * interaction-state machine (panning→marqueeing→idle) is unreliable across input
 * paths. Catches pan + zoom + programmatic setCamera uniformly.
 */
export function useTrackBoardCameraMotion(store: CanvasStore): void {
  useEffect(() => {
    const e = getEntry(store)
    let timer: ReturnType<typeof setTimeout> | null = null
    const onCamera = (): void => {
      setAtRest(e, false)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setAtRest(e, true), QUIET_MS)
    }
    const unsub = store.subscribe("camera", onCamera)
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
      setAtRest(e, true)
    }
  }, [store])
}


/**
 * Whether the given board's camera has been at rest for QUIET_MS. Pass
 * `waiting = false` for views that don't currently need to react (already mounted,
 * or off-screen): the snapshot then returns a constant, so camera motion across a
 * dense board doesn't re-render them — only in-view, not-yet-mounted views
 * re-render on the atRest transition that actually boots them.
 */
export function useBoardCameraAtRest(store: CanvasStore, waiting: boolean): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const e = getEntry(store)
      e.listeners.add(cb)
      return () => {
        e.listeners.delete(cb)
      }
    },
    [store],
  )
  return useSyncExternalStore(subscribe, () => (waiting ? getEntry(store).atRest : true))
}
