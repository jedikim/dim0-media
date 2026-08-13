import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react"
import { useCanvasStore } from "@canvas-harness/react"
import type { CanvasStore } from "@canvas-harness/core"
import { useBoardCameraAtRest } from "../canvas/board-camera-motion"
import { requestMountSlot } from "./mount-scheduler"
import { useIsInView } from "./use-is-in-view"


export type DeferredMount = {
  /** Whether the node's heavy content should currently be mounted. */
  shouldMount: boolean
  /** Raw viewport intersection — for content-visibility / resize gating. */
  isInView: boolean
}


/** Distance from the element's center to the viewport center — mount-order priority. */
function viewportCenterDistance(ref: RefObject<HTMLElement | null>): number {
  const el = ref.current
  if (!el || typeof window === "undefined") return Infinity
  const r = el.getBoundingClientRect()
  const dx = r.left + r.width / 2 - window.innerWidth / 2
  const dy = r.top + r.height / 2 - window.innerHeight / 2
  return Math.hypot(dx, dy)
}


/**
 * Factory for the "defer heavy on-canvas node mounting until the pan settles"
 * behavior shared by heavy node views (mini-app iframes, sheet editors). Each
 * call creates an INDEPENDENT retention pool (per node type), scoped per board
 * (per CanvasStore) so two boards overlapping during a route transition never
 * evict each other's retained nodes. The returned hook:
 *   - a FRESH node mounts only after the camera settles, and then only when the
 *     shared per-board scheduler grants it a slot (~one per frame, nearest
 *     viewport center first) — so a settle into a region full of heavy nodes
 *     trickles in instead of freezing the main thread, and a new pan drops the
 *     un-granted requests instead of fighting them;
 *   - a RETAINED node (kept alive from a recent visit) mounts instantly, bypassing
 *     the scheduler;
 *   - a mounted node stays while it's in view OR retained, so a genuinely visible
 *     node is never torn down; it unmounts only once off-screen AND evicted;
 *   - retains the most-recently-active `cap` off-screen nodes (bounded LRU).
 */
export function createDeferredMount({
  cap,
  rootMargin = "200px",
}: {
  cap: number
  rootMargin?: string
}) {
  // Per-board (per CanvasStore) bounded-LRU pool. `live` is MRU-first; listeners
  // drive useSyncExternalStore. WeakMap so entries drop with their store.
  type Pool = { live: string[]; listeners: Set<() => void> }
  const pools = new WeakMap<CanvasStore, Pool>()

  const getPool = (store: CanvasStore): Pool => {
    let p = pools.get(store)
    if (!p) {
      p = { live: [], listeners: new Set() }
      pools.set(store, p)
    }
    return p
  }

  const touch = (store: CanvasStore, id: string): void => {
    const p = getPool(store)
    const next = [id, ...p.live.filter((x) => x !== id)]
    p.live = next.length > cap ? next.slice(0, cap) : next
    for (const l of p.listeners) l()
  }

  const release = (store: CanvasStore, id: string): void => {
    const p = getPool(store)
    if (!p.live.includes(id)) return
    p.live = p.live.filter((x) => x !== id)
    for (const l of p.listeners) l()
  }

  return function useDeferredMount(
    id: string,
    ref: RefObject<HTMLElement | null>,
  ): DeferredMount {
    const store = useCanvasStore()
    // initialInView: false — don't mount every node on first load before the
    // observer reports which are actually visible (and don't seed the LRU).
    const isInView = useIsInView(ref, rootMargin, false)

    const subscribe = useCallback(
      (cb: () => void) => {
        const p = getPool(store)
        p.listeners.add(cb)
        return () => {
          p.listeners.delete(cb)
        }
      },
      [store],
    )
    const isLive = useSyncExternalStore(subscribe, () => getPool(store).live.includes(id))

    // `everMounted` latches on the scheduler grant so a visible node stays mounted
    // after eviction. Only a FRESH candidate — in view, not retained, not yet
    // mounted — waits on the camera + scheduler; everyone else reads constants, so
    // camera motion doesn't re-render the whole board's heavy views.
    const [everMounted, setEverMounted] = useState(false)
    const wantsMount = isInView && !isLive && !everMounted
    const cameraAtRest = useBoardCameraAtRest(store, wantsMount)
    const requesting = wantsMount && cameraAtRest

    // Request a mount slot while waiting-at-rest; withdraw on camera move / leaving
    // view / unmount. Every visible candidate withdrawing on move is exactly how
    // "drop all waiting jobs" happens — the scheduler queue drains itself.
    useEffect(() => {
      if (!requesting) return
      return requestMountSlot(store, id, viewportCenterDistance(ref), () =>
        setEverMounted(true),
      )
    }, [requesting, store, id, ref])

    const active = isInView && everMounted
    const shouldMount = isLive || active

    // Retain most-recently-active nodes: touch on active-enter and active-exit
    // (keyed on `active`, not pool membership, so eviction can't re-add).
    const wasActive = useRef(false)
    useEffect(() => {
      if (active) wasActive.current = true
      if (active || wasActive.current) touch(store, id)
    }, [active, store, id])
    useEffect(() => () => release(store, id), [store, id])

    // Fully gone (off-screen AND evicted) → forget it was mounted, so a later
    // re-entry goes back through the scheduler.
    useEffect(() => {
      if (!isInView && !isLive) setEverMounted(false)
    }, [isInView, isLive])

    return { shouldMount, isInView }
  }
}
