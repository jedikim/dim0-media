import { useEffect } from "react"
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router"
import { BoardUrl } from "@/routes"
import { useGraphStore, setBoardNavigate } from "../store/graph-store"
import { nodeSurfaceKindFromPath } from "../utils/node-surface-url"


/**
 * Bidirectional sync between URL and `activeNodeSurface` state.
 *
 * 1. URL → state: when the route is `/boards/:id/{sheets,code-sandbox,
 *    widgets}/:noteId`, set `activeNodeSurface` to that note. When the
 *    route is just the board, clear it.
 * 2. State → URL: every `openNodeSurface` / `closeNodeSurface` action
 *    pushes a matching navigate via `setBoardNavigate` (registered here).
 *
 * Both sides guard against redundant updates so they don't loop.
 */
export function useActiveSurfaceFromUrl(): void {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const params = useParams({ strict: false }) as { noteId?: string }
  const noteId = params.noteId
  const kind = nodeSurfaceKindFromPath(pathname)

  // Register the navigate functions the store uses for state → URL.
  // `search: (prev) => prev` keeps `current_chat_id`, `root_id`, etc. when
  // entering or leaving a surface — otherwise opening a sheet drops the
  // user's active chat.
  useEffect(() => {
    setBoardNavigate(
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
    const current = useGraphStore.getState().activeNodeSurface
    if (noteId && kind) {
      if (current?.nodeId === noteId && current?.kind === kind) return
      useGraphStore.setState({ activeNodeSurface: { nodeId: noteId, kind } })
      return
    }
    if (current !== null) {
      useGraphStore.setState({ activeNodeSurface: null })
    }
  }, [noteId, kind])
}
