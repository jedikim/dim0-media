import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { CaretRightIcon } from "@phosphor-icons/react"
import { LocalBoardUrl } from "@/routes"
import { Button } from "@/components/ui/button"
import { getLocalStores } from "@/features/local-stores"
import { BoardPersistence } from "@/features/board/persist/local/board-persistence"
import { buildLayerPath, type LayerCrumb } from "@/features/board/model/layer"


/**
 * Folder breadcrumb for a LOCAL board. When inside a folder (rootId set), it
 * walks the whole board's `parentId` chain to render Board › A › B, each crumb
 * jumping to that layer via the `root_id` search param. Hidden at the root.
 *
 * The path is built locally (no backend note-path endpoint): it loads the
 * whole-board content once per (board, layer) change and resolves ancestors.
 */
export function LocalFolderBreadcrumb({ boardId, rootId }: { boardId: string; rootId: string | null }) {
  const navigate = useNavigate()
  const [crumbs, setCrumbs] = useState<LayerCrumb[]>([])

  useEffect(() => {
    if (!boardId || !rootId) {
      setCrumbs([])
      return
    }
    let cancelled = false
    void getLocalStores().then(async ({ engine }) => {
      const persistence = new BoardPersistence(boardId, { engine })
      const content = await persistence.load()
      if (!cancelled) setCrumbs(buildLayerPath(content.nodes, rootId))
    })
    return () => {
      cancelled = true
    }
  }, [boardId, rootId])

  if (!rootId) return null

  const goTo = (layerId: string | null) =>
    navigate({
      to: LocalBoardUrl,
      params: { boardId },
      search: (prev: Record<string, unknown>) => ({ ...prev, root_id: layerId ?? undefined }),
    })

  return (
    <nav className="absolute left-4 top-4 z-50 flex max-w-[70vw] items-center gap-0.5 overflow-x-auto rounded-md border border-border bg-background/90 px-2 py-1 shadow-sm backdrop-blur">
      <Button
        variant="ghost"
        size="sm"
        className="h-auto px-1.5 py-0.5 text-sm font-normal hover:underline"
        onClick={() => goTo(null)}
      >
        Board
      </Button>
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <div key={crumb.id} className="flex items-center gap-0.5">
            <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
            <Button
              variant="ghost"
              size="sm"
              disabled={isLast}
              className="h-auto max-w-[200px] truncate px-1.5 py-0.5 text-sm font-normal hover:underline disabled:opacity-100"
              onClick={() => goTo(crumb.id)}
            >
              {crumb.label}
            </Button>
          </div>
        )
      })}
    </nav>
  )
}
