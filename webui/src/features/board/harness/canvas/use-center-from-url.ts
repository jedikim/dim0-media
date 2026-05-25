import { useEffect, type RefObject } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import type { CanvasStore, Node, NodeId } from "@canvas-harness/core"


/** Padding around the union rect when fitting multiple nodes, as a fraction of viewport. */
const FIT_PADDING = 0.1
/** Highest zoom level allowed when fitting (avoid zooming way in on a single small target). */
const MAX_FIT_ZOOM = 2


/**
 * Read `?center=<id>` or `?center=<id1>,<id2>,…` from the URL. Once the
 * store is `ready` (hydration finished), look up the targets and either:
 *
 *  - Single id: snap the camera to center that node, keep current zoom.
 *  - Multiple ids: compute the union bounding rect of all resolved
 *    targets and fit-to-rect with `FIT_PADDING` margins. The zoom is
 *    chosen to cover the rect; capped at `MAX_FIT_ZOOM` so a tightly
 *    grouped pair doesn't zoom in absurdly.
 *
 * After applying, the `center` param is stripped so a later refresh
 * doesn't re-snap if the user has panned in the meantime.
 *
 * Mounted AFTER viewport persistence so a shareable `?center=` link
 * wins over the cached pan from a prior session.
 */
export const useCenterFromUrl = (
  store: CanvasStore,
  wrapRef: RefObject<HTMLElement | null>,
  ready: boolean,
): void => {
  const navigate = useNavigate()
  const search = useSearch({
    strict: false,
    select: (s: { center?: string }) => s?.center,
  })

  useEffect(() => {
    if (!ready || !search) return
    const wrap = wrapRef.current
    if (!wrap) return

    const stripCenter = (): void => {
      navigate({
        to: ".",
        search: (prev: Record<string, unknown>) => {
          const next = { ...prev } as Record<string, unknown>
          delete next.center
          return next
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }

    const ids = search.split(",").map((s) => s.trim()).filter(Boolean)
    const nodes = ids
      .map((id) => store.getNode(id as NodeId))
      .filter((n): n is Node => !!n)

    if (nodes.length === 0) {
      // All ids stale — drop the param silently.
      stripCenter()
      return
    }

    const rect = wrap.getBoundingClientRect()
    if (nodes.length === 1) {
      const node = nodes[0]
      const cam = store.getCamera()
      const centerWorld = { x: node.x + node.w / 2, y: node.y + node.h / 2 }
      store.setCamera({
        x: centerWorld.x - rect.width / (2 * cam.z),
        y: centerWorld.y - rect.height / (2 * cam.z),
        z: cam.z,
      })
      stripCenter()
      return
    }

    // Multi-node: fit the union AABB with padding, recompute zoom.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.w)
      maxY = Math.max(maxY, n.y + n.h)
    }
    const worldW = maxX - minX
    const worldH = maxY - minY
    // Pad so the rect isn't flush against the viewport edge.
    const padX = rect.width * FIT_PADDING
    const padY = rect.height * FIT_PADDING
    const availW = Math.max(1, rect.width - 2 * padX)
    const availH = Math.max(1, rect.height - 2 * padY)
    const fitZ = Math.min(MAX_FIT_ZOOM, availW / worldW, availH / worldH)
    const z = Math.max(0.05, fitZ)
    const centerWorld = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    store.setCamera({
      x: centerWorld.x - rect.width / (2 * z),
      y: centerWorld.y - rect.height / (2 * z),
      z,
    })
    stripCenter()
  }, [ready, search, store, wrapRef, navigate])
}
