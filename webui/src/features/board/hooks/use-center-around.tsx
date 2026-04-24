import { useEffect } from "react"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"

import { nodeCenter } from "../utils/point-attach"
import { useGraphStore } from "../store/graph-store"
import { useFitNodes } from "./use-fit-nodes"


/**
 * Upper cap on viewport zoom when auto-centering on a node so we never
 * yank an over-zoomed user even closer. Below the cap we keep the user's
 * current zoom to preserve their context.
 */
const MAX_AUTO_CENTER_ZOOM = 1


/**
 * Type for the `center_around` search param. Accepts a single id or a
 * comma-separated list of ids.
 */
type CenterAroundSearch = { center_around?: string }

/**
 * Drives the viewport from the `center_around` search param. A single id
 * centers the viewport on that node while preserving the user's current
 * zoom; multiple comma-separated ids fit the viewport to the whole set
 * (useful when an agent turn produces several notes at once).
 * After dispatching, the param is removed to avoid repeated recentering.
 */
export function useCenterAroundParam({
  setCenter,
}: {
  setCenter?: (x: number, y: number, options?: { zoom?: number; duration?: number }) => void
}) {
  const navigate = useNavigate()
  const nodesById = useGraphStore(state => state.nodesById)
  const zoom = useGraphStore(state => state.zoom)
  const fitNodes = useFitNodes()

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
    if (!search) return
    const ids = search.split(",").map(id => id.trim()).filter(Boolean)
    if (ids.length === 0) return

    if (ids.length === 1) {
      if (!setCenter) return
      const node = nodesById.get(ids[0])
      if (!node) return
      const { x, y } = nodeCenter(node)
      const targetZoom = Math.min(zoom, MAX_AUTO_CENTER_ZOOM)
      setCenter(x, y, { zoom: targetZoom, duration: 250 })
    } else {
      void fitNodes(ids, { padding: 0.25, duration: 300, maxZoom: MAX_AUTO_CENTER_ZOOM })
    }

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
  }, [search, nodesById, setCenter, fitNodes, navigate, params, zoom])
}
