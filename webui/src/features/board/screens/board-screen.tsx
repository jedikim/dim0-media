import { useEffect } from "react"
import { Outlet, useParams, useSearch } from "@tanstack/react-router"
import { BoardView } from "../components/board-view"
import { useHarnessSurfaceFromUrl } from "../harness/hooks/use-surface-from-url"
import { useBoardAppStore } from "../harness/store/board-app-store"


// Board screen — parent route for the canvas. The surface routes
// (/sheets/$noteId, /code-sandbox/$noteId, /widgets/$noteId) are nested
// children that render `null` into <Outlet/>, so navigating into and out
// of a surface keeps BoardView (and the harness canvas) mounted. Board
// scope (boardId / rootId) is derived from the URL here and pushed onto
// the harness app store; everything else reads from there.
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

  const setBoardScope = useBoardAppStore((s) => s.setBoardScope)

  useEffect(() => {
    if (!boardId) return
    setBoardScope({ boardId, rootId: rootId ?? null })
  }, [boardId, rootId, setBoardScope])

  useHarnessSurfaceFromUrl()

  return (
    <>
      <BoardView />
      <Outlet />
    </>
  )
}
