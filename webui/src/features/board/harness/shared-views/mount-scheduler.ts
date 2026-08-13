import type { CanvasStore } from "@canvas-harness/core"
import { isBoardCameraAtRest } from "../canvas/board-camera-motion"


// Grant at most one mount per this many animation frames. Spreads N settle-time
// mounts into a cascade so no single frame boots them all — the fix for the
// "settle → freeze → jank if you move again" burst. ~4 frames (~15 mounts/s at
// 60Hz) leaves idle frames between mounts for smoothness — worth most on the
// in-process desktop (WKWebView) webview, where a mount runs on the host thread.
// Higher = gentler/slower.
const FRAMES_PER_GRANT = 4


type Request = { priority: number; grant: () => void }
type Scheduler = { pending: Map<string, Request>; raf: number | null; frame: number }

// One scheduler per board (per CanvasStore), SHARED across node types (mini-apps
// + sheets) so the admission rate is global, not per-type. WeakMap drops with the
// store.
const schedulers = new WeakMap<CanvasStore, Scheduler>()


function getScheduler(store: CanvasStore): Scheduler {
  let s = schedulers.get(store)
  if (!s) {
    s = { pending: new Map(), raf: null, frame: 0 }
    schedulers.set(store, s)
  }
  return s
}


function tick(store: CanvasStore): void {
  const s = getScheduler(store)
  s.raf = null
  if (s.pending.size === 0) return
  // Only admit while the camera is at rest. On motion the requesters withdraw
  // themselves (their `requesting` flips false), draining `pending` — this guard
  // also covers the sub-frame gap before their effect cleanup runs. Reset the
  // frame counter while moving so the cascade restarts cleanly on the next settle
  // (otherwise, with FRAMES_PER_GRANT > 1, the first post-pan grant fires early).
  if (!isBoardCameraAtRest(store)) {
    s.frame = 0
  } else if (++s.frame >= FRAMES_PER_GRANT) {
    s.frame = 0
    // Grant the nearest-to-viewport-center pending request first (center-out).
    // `bestId === null ||` guarantees a pick even if every priority is Infinity
    // (null ref) — otherwise that request would never be granted or deleted and
    // this rAF loop would spin forever, pinning the store.
    let bestId: string | null = null
    let best = Infinity
    for (const [id, r] of s.pending) {
      if (bestId === null || r.priority < best) {
        best = r.priority
        bestId = id
      }
    }
    if (bestId !== null) {
      const r = s.pending.get(bestId)
      s.pending.delete(bestId)
      r?.grant()
    }
  }
  if (s.pending.size > 0) s.raf = requestAnimationFrame(() => tick(store))
}


/**
 * Ask to mount `id` on this board. The scheduler grants ~one request per frame
 * (nearest viewport center first) while the camera is at rest, so a settle into a
 * region full of heavy nodes trickles in instead of freezing the main thread.
 * Returns a withdraw fn — call it when the node no longer wants to mount (camera
 * moved, node left view, or it unmounted); withdrawing drops the request from the
 * queue WITHOUT granting it, which is how "drop all waiting jobs on move" works
 * (every visible candidate withdraws when the camera moves).
 */
export function requestMountSlot(
  store: CanvasStore,
  id: string,
  priority: number,
  grant: () => void,
): () => void {
  const s = getScheduler(store)
  s.pending.set(id, { priority, grant })
  if (s.raf === null) s.raf = requestAnimationFrame(() => tick(store))
  return () => {
    s.pending.delete(id)
    // Last one out cancels the loop so a drained queue doesn't leave a scheduled
    // no-op tick (and its store-capturing closure) hanging.
    if (s.pending.size === 0 && s.raf !== null) {
      cancelAnimationFrame(s.raf)
      s.raf = null
    }
  }
}
