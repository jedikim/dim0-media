import { useEffect } from "react"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"

import { nodeCenter } from "../utils/point-attach"
import { useGraphStore } from "../store/graph-store"


/**
 * Upper cap on viewport zoom when auto-centering on a node so we never
 * yank an over-zoomed user even closer. Below the cap we keep the user's
 * current zoom to preserve their context.
 */
const MAX_AUTO_CENTER_ZOOM = 1


/**
 * Type for the `center_around` search param.
 */
type CenterAroundSearch = { center_around?: string }

/**
 * Centers the board viewport on a node when the `center_around` search param is present.
 * After centering, the param is removed to avoid repeated recentering.
 */
export function useCenterAroundParam({
  setCenter,
}: {
  setCenter?: (x: number, y: number, options?: { zoom?: number; duration?: number }) => void
}) {
  const navigate = useNavigate()
  const nodesById = useGraphStore(state => state.nodesById)
  const zoom = useGraphStore(state => state.zoom)

  const params = useParams({
    from: "/boards/$id",
    select: (p: { id: string }) => p.id,
    shouldThrow: false,
  })

  const search = useSearch({
    from: "/boards/$id",
    select: (s: CenterAroundSearch) => s.center_around,
    shouldThrow: false,
  })

  useEffect(() => {
    if (!search || !setCenter) return
    const node = nodesById.get(search)
    if (!node) return

    const { x, y } = nodeCenter(node)
    const targetZoom = Math.min(zoom, MAX_AUTO_CENTER_ZOOM)
    setCenter(x, y, { zoom: targetZoom, duration: 250 })

    if (!params) return
    navigate({
      to: "/boards/$id",
      params: { id: params },
      replace: true,
      search: (prev: Record<string, unknown>) => {
        if (!prev?.center_around) return prev
        const next = { ...prev }
        delete next.center_around
        return next
      },
    })
  }, [search, nodesById, setCenter, navigate, params, zoom])
}
