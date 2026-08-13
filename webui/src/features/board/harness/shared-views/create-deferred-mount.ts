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
import { useIsInView } from "./use-is-in-view"


export type DeferredMount = {
  /** Whether the node's heavy content should currently be mounted. */
  shouldMount: boolean
  /** Raw viewport intersection — for content-visibility / resize gating. */
  isInView: boolean
}


/**
 * Factory for the "defer heavy on-canvas node mounting until the pan settles"
 * behavior shared by heavy node views (mini-app iframes, sheet editors). Each
 * call creates an INDEPENDENT retention pool (per node type), and the pool is
 * further scoped per board (per CanvasStore) so two boards overlapping during a
 * route transition never evict each other's retained nodes. The returned hook:
 *   - mounts a node only when it's in view AND the board camera is at rest — so
 *     panning/scrolling at any speed boots nothing new — or immediately if it's
 *     kept alive from a recent visit;
 *   - keeps a mounted node while it's in view OR retained, so a genuinely visible
 *     node is never torn down; it unmounts only once off-screen AND evicted;
 *   - retains the most-recently-active `cap` off-screen nodes (bounded LRU) so
 *     panning back re-uses the live instance instead of remounting.
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

    // `everMounted` remembers that the node has been mounted so `shouldMount` can
    // be derived SYNCHRONOUSLY (no one-frame placeholder flash for already-live /
    // already-mounted nodes) while still keeping a visible node mounted after
    // eviction. State (not a ref) so `waiting` stays a pure render value.
    const [everMounted, setEverMounted] = useState(false)
    // A node only needs to react to camera motion while it's waiting to boot:
    // in view, not yet live, not yet mounted. Everyone else reads a constant, so
    // a pan doesn't re-render the whole board's heavy views.
    const waiting = isInView && !isLive && !everMounted
    const cameraAtRest = useBoardCameraAtRest(store, waiting)
    const mountReady = isInView && cameraAtRest
    const shouldMount = mountReady || isLive || (isInView && everMounted)

    const wasActive = useRef(false)
    useEffect(() => {
      if (mountReady) wasActive.current = true
      // Retain the most-recently-active nodes: touch on active-enter and on
      // active-exit (was active, just left); never a node that was never active.
      if (mountReady || wasActive.current) touch(store, id)
    }, [mountReady, store, id])
    useEffect(() => () => release(store, id), [store, id])

    useEffect(() => {
      if (shouldMount) setEverMounted(true)
      else if (!isInView && !isLive) setEverMounted(false)
    }, [shouldMount, isInView, isLive])

    return { shouldMount, isInView }
  }
}
