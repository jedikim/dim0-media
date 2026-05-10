import { BoardView } from "../components/board-view"
import { Outlet, useParams, useSearch } from "@tanstack/react-router"
import { useGraphStore } from "../store/graph-store"
import { useEffect } from "react"
import { useActiveSurfaceFromUrl } from "../hooks/use-active-surface-from-url"


// Board screen — parent route for the canvas. The surface routes
// (/sheets/$noteId, /code-sandbox/$noteId, /widgets/$noteId) are nested
// children that render `null` into <Outlet/>, so navigating into and out
// of a surface keeps BoardView (and React Flow) mounted. Surface state
// is driven from the URL via `useActiveSurfaceFromUrl`.
export const BoardScreen = () => {
  // `strict: false` so we can read params regardless of which board-tree
  // route matched (board vs. sheet vs. code-sandbox vs. widget).
  const params = useParams({ strict: false }) as { id?: string }
  const boardId = params.id ?? ""
  const boardSearch = useSearch({
    strict: false,
    select: (s: { root_id?: string }) => ({ rootId: s?.root_id }),
  })
  const rootId = boardSearch?.rootId

  const setGraphScope = useGraphStore(state => state.setGraphScope)

  useEffect(() => {
    if (!boardId) return
    setGraphScope({ boardId, rootId })
  }, [boardId, rootId, setGraphScope])

  useActiveSurfaceFromUrl()

  return (
    <>
      <BoardView />
      <Outlet />
    </>
  )
}
