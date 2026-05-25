import { useEffect } from "react"
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router"
import { BoardUrl } from "@/routes"
import { nodeSurfaceKindFromPath } from "@/features/board/utils/node-surface-url"
import {
  setNodeSurfaceNavigator,
  useBoardAppStore,
} from "../store/board-app-store"


/**
 * Bidirectional sync between the URL and the harness app store's
 * `activeNodeSurface`. Port of the legacy `useActiveSurfaceFromUrl`
 * but pointed at `useBoardAppStore` instead of `useGraphStore`.
 *
 * 1. URL → state: when the route is
 *    `/boards/:id/{sheets,code-sandbox,widgets}/:noteId`, write
 *    `activeNodeSurface` to that note. When the route is just the
 *    board, clear it.
 * 2. State → URL: register navigate callbacks via
 *    `setNodeSurfaceNavigator` so `openNodeSurface` / `closeNodeSurface`
 *    push the matching route. Search params (`root_id`,
 *    `current_chat_id`) are preserved so navigating in / out of a
 *    surface keeps the user's folder context.
 *
 * Both directions guard against redundant updates so they don't loop.
 */
export function useHarnessSurfaceFromUrl(): void {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const params = useParams({ strict: false }) as { noteId?: string }
  const noteId = params.noteId
  const kind = nodeSurfaceKindFromPath(pathname)

  // State → URL: register navigate fns the store can call when actions
  // fire. Re-register on every `navigate` identity change.
  useEffect(() => {
    setNodeSurfaceNavigator(
      (path, navParams) => {
        navigate({
          to: path,
          params: navParams,
          search: (prev: Record<string, unknown>) => prev,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
      },
      (boardId) => {
        navigate({
          to: BoardUrl,
          params: { id: boardId },
          search: (prev: Record<string, unknown>) => prev,
        })
      },
    )
  }, [navigate])

  // URL → state.
  useEffect(() => {
    const current = useBoardAppStore.getState().activeNodeSurface
    if (noteId && kind) {
      if (current?.nodeId === noteId && current?.kind === kind) return
      useBoardAppStore.setState({ activeNodeSurface: { nodeId: noteId, kind } })
      return
    }
    if (current !== null) {
      useBoardAppStore.setState({ activeNodeSurface: null })
    }
  }, [noteId, kind])
}
