import { useEffect, useRef, useState, type RefObject } from "react"
import { useCanvasStore } from "@canvas-harness/react"
import { create } from "zustand"
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
 * call creates an INDEPENDENT bounded-LRU retention pool, so different node types
 * never evict each other (an iframe shouldn't push out a sheet, and their caps
 * differ). The returned hook:
 *   - mounts a node only when it's in view AND the board camera is at rest — so
 *     panning/scrolling at any speed boots nothing new (the measured jank) — or
 *     immediately if it's kept alive from a recent visit;
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
  type Pool = {
    live: string[]
    touch: (id: string) => void
    release: (id: string) => void
  }
  const usePool = create<Pool>((set) => ({
    live: [],
    touch: (id) =>
      set((s) => {
        const next = [id, ...s.live.filter((x) => x !== id)]
        return { live: next.length > cap ? next.slice(0, cap) : next }
      }),
    release: (id) => set((s) => ({ live: s.live.filter((x) => x !== id) })),
  }))

  return function useDeferredMount(
    id: string,
    ref: RefObject<HTMLElement | null>,
  ): DeferredMount {
    const store = useCanvasStore()
    // initialInView: false — don't mount every node on first load before the
    // observer reports which are actually visible (and don't seed the LRU).
    const isInView = useIsInView(ref, rootMargin, false)

    const isLive = usePool((s) => s.live.includes(id))
    const touch = usePool((s) => s.touch)
    const release = usePool((s) => s.release)

    // Only an in-view, not-yet-mounted node needs to react to camera motion — a
    // mounted or off-screen node ignores it, so a pan doesn't re-render every
    // heavy view on the board (see useBoardCameraAtRest's `waiting`).
    const mountedRef = useRef(false)
    const cameraAtRest = useBoardCameraAtRest(store, isInView && !mountedRef.current)
    const mountReady = isInView && cameraAtRest

    const wasActive = useRef(false)
    useEffect(() => {
      if (mountReady) wasActive.current = true
      // Retain the most-recently-active nodes: touch on active-enter and on
      // active-exit (was active, just left); never a node that was never active.
      if (mountReady || wasActive.current) touch(id)
    }, [mountReady, id, touch])
    useEffect(() => () => release(id), [id, release])

    const [shouldMount, setShouldMount] = useState(false)
    useEffect(() => {
      if (mountReady || isLive) {
        mountedRef.current = true
        setShouldMount(true)
      } else if (!isInView && !isLive) {
        mountedRef.current = false
        setShouldMount(false)
      }
    }, [mountReady, isLive, isInView])

    return { shouldMount, isInView }
  }
}
