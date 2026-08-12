import { useEffect, useRef } from "react"
import { create } from "zustand"


// Max mini-app iframes kept mounted while off-screen. Comfortably above how many
// fit on one screen, so the eviction below never tears down a *visible* node
// (in-view nodes stay mounted regardless — see useMiniAppKeepAlive). It bounds
// the retained iframes — and their still-running event loops — on boards with
// many mini-apps.
const CAP = 8


type KeepAliveState = {
  live: string[]
  touch: (id: string) => void
  release: (id: string) => void
}


/**
 * Module-wide LRU of mounted mini-app iframes (MRU first). `touch` promotes a
 * node and evicts the least-recently-seen beyond CAP; `release` drops a node
 * that has been removed from the board entirely.
 */
const useKeepAliveStore = create<KeepAliveState>((set) => ({
  live: [],
  touch: (id) =>
    set((s) => {
      const next = [id, ...s.live.filter((x) => x !== id)]
      return { live: next.length > CAP ? next.slice(0, CAP) : next }
    }),
  release: (id) => set((s) => ({ live: s.live.filter((x) => x !== id) })),
}))


/**
 * Whether a mini-app node should keep its iframe mounted. True while in view,
 * and kept true for the most-recently-seen CAP nodes after they scroll off — so
 * scrolling back re-uses the live iframe instead of re-parsing the ~5 MB runtime.
 * Because the result is `isInView || isLive`, an in-view node is never unmounted
 * even if eviction drops it from the live set; only OFF-SCREEN retention is
 * bounded (in-view nodes always mount — matching the pre-existing behavior).
 *
 * Recency is stamped both on view-enter AND on view-exit, so the node the user
 * just scrolled away from is the most-recently-used (survives eviction longest);
 * stamping only on enter would age the just-left node toward the tail. A node
 * that is never observed in view (see `initialInView: false` at the call site)
 * never enters the set, so initial load doesn't seed it with off-screen nodes.
 */
export function useMiniAppKeepAlive(id: string, isInView: boolean): boolean {
  const isLive = useKeepAliveStore((s) => s.live.includes(id))
  const touch = useKeepAliveStore((s) => s.touch)
  const release = useKeepAliveStore((s) => s.release)
  const wasInView = useRef(false)

  useEffect(() => {
    if (isInView) wasInView.current = true
    // Touch on enter (in view now) and on exit (was in view, just left) — but
    // never for a node that has never been observed in view.
    if (isInView || wasInView.current) touch(id)
  }, [isInView, id, touch])

  useEffect(() => () => release(id), [id, release])

  return isInView || isLive
}
