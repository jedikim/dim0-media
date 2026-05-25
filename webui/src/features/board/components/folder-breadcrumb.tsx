import { useEffect, useMemo } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { useGetNotePath } from "../api/get-note-path"
import { useBoardAppStore } from "../harness/store/board-app-store"


const normalizeLabel = (markdown?: string) => {
  const text = (markdown ?? "").replace(/\s+/g, " ").trim()
  return text || "Untitled"
}


/**
 * Folder path breadcrumb for the sidebar header. Reads the parent
 * chain via `useGetNotePath` and renders one button per ancestor;
 * clicking jumps the board to that folder by setting `root_id`.
 *
 * Side-effect: keeps `currentFolderDepth` on the board-app-store in
 * sync with the URL so other chrome (e.g. toolbar "Sub-board" entry)
 * can gate UX on depth.
 */
export function FolderBreadcrumb({
  boardId,
  rootId,
  inline = false,
  boardLabel,
}: {
  boardId?: string
  rootId?: string
  inline?: boolean
  boardLabel?: string
}) {
  const navigate = useNavigate()
  const setCurrentFolderDepth = useBoardAppStore((s) => s.setCurrentFolderDepth)
  const { data: path = [] } = useGetNotePath({ boardId, noteId: rootId, enabled: !!rootId })

  const crumbs = useMemo(
    () =>
      path.map((note) => ({
        id: note.id,
        label: normalizeLabel(note.label?.markdown),
      })),
    [path],
  )

  useEffect(() => {
    setCurrentFolderDepth(rootId ? path.length - 1 : -1)
  }, [path.length, rootId, setCurrentFolderDepth])

  if (!boardId || !rootId) return null

  if (inline) {
    return (
      <div className="flex min-w-0 max-w-[60vw] items-center gap-1 overflow-x-auto">
        {boardLabel ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto max-w-[200px] truncate px-0 text-sm font-normal hover:underline"
            title={boardLabel}
            onClick={() =>
              navigate({
                to: "/boards/$id",
                params: { id: boardId },
                search: (prev: Record<string, unknown>) => {
                  const next = { ...prev } as Record<string, unknown>
                  delete next.root_id
                  return next
                },
              })
            }
          >
            {boardLabel}
          </Button>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">/</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-0 text-sm font-normal hover:underline"
              onClick={() =>
                navigate({
                  to: "/boards/$id",
                  params: { id: boardId },
                  search: (prev: Record<string, unknown>) => {
                    const next = { ...prev } as Record<string, unknown>
                    delete next.root_id
                    return next
                  },
                })
              }
            >
              ...
            </Button>
          </>
        )}

        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          const crumbLabel = isLast ? crumb.label : "..."
          return (
            <div key={crumb.id} className="flex min-w-0 items-center gap-1">
              <span className="text-sm text-muted-foreground">/</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto max-w-[180px] truncate px-0 text-sm font-normal hover:underline"
                disabled={isLast}
                onClick={() =>
                  navigate({
                    to: "/boards/$id",
                    params: { id: boardId },
                    search: (prev: Record<string, unknown>) => ({
                      ...prev,
                      root_id: crumb.id,
                    }),
                  })
                }
              >
                {crumbLabel}
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex max-w-[60vw] items-center gap-1 overflow-x-auto rounded-lg border border-border bg-sidebar/90 px-2 py-1.5 backdrop-blur">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() =>
          navigate({
            to: "/boards/$id",
            params: { id: boardId },
            search: (prev: Record<string, unknown>) => {
              const next = { ...prev } as Record<string, unknown>
              delete next.root_id
              return next
            },
          })
        }
      >
        Root
      </Button>

      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1
        const crumbLabel = isLast ? crumb.label : "..."
        return (
          <div key={crumb.id} className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">/</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 max-w-[180px] truncate px-2 text-xs"
              disabled={isLast}
              onClick={() =>
                navigate({
                  to: "/boards/$id",
                  params: { id: boardId },
                  search: (prev: Record<string, unknown>) => ({
                    ...prev,
                    root_id: crumb.id,
                  }),
                })
              }
            >
              {crumbLabel}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
