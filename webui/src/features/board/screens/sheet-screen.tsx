import { useEffect, useMemo } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { SheetEditor } from "../components/sheet/sheet-editor"
import { useGetNote } from "../api/get-note"
import { useGetNotePath } from "../api/get-note-path"
import { updateNote } from "../api/update-note"
import { cn } from "@/lib/utils"
import { SheetUrl } from "@/routes"
import { useGraphStore } from "../store/graph-store"
import { createBoardPageProvider } from "../providers/board-page-provider"
import { SheetBreadcrumb } from "../components/sheet/sheet-breadcrumb"

export const SheetScreen = () => {
  const { id: boardId, noteId } = useParams({ from: SheetUrl }) as { id: string; noteId: string }
  const navigate = useNavigate()
  const setGraphScope = useGraphStore(state => state.setGraphScope)

  useEffect(() => {
    setGraphScope({ boardId, rootId: undefined })
  }, [boardId, setGraphScope])

  const { data: note, isLoading } = useGetNote({ boardId, noteId })
  const { data: notePath = [] } = useGetNotePath({ boardId, noteId })
  const ancestors = notePath.slice(0, -1)

  // Real backend-backed PageProvider (same shape as the dialog wires).
  // In full-page mode, navigating to a referenced page swaps the route to
  // that note's full-page view — staying in the same surface the user
  // started in.
  const pageProvider = useMemo(
    () =>
      createBoardPageProvider({
        boardId,
        parentNoteId: noteId,
        onNavigate: (id) =>
          navigate({ to: SheetUrl, params: { id: boardId, noteId: id } }),
      }),
    [boardId, noteId, navigate],
  )

  const mutation = useMutation({
    mutationFn: (markdown: string) =>
      updateNote(boardId, noteId, { content: { markdown } }),
  })

  const handleSave = (markdown: string) => {
    mutation.mutate(markdown)
  }

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <div className={cn("flex-1 min-h-0 min-w-0 p-4 sm:p-8 overflow-y-auto scrollbar-thin")}>
        {isLoading || !note ? (
          <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
            Loading sheet...
          </div>
        ) : (
          <div className="h-full w-full rounded-lg bg-background">
            <div className='w-full max-w-[1000px] h-full mx-auto flex flex-col'>
              <div className="px-2 pb-2">
                <SheetBreadcrumb
                  ancestors={ancestors}
                  onSegmentClick={(id) =>
                    navigate({ to: SheetUrl, params: { id: boardId, noteId: id } })
                  }
                />
              </div>
              <div className="flex-1 min-h-0">
                <SheetEditor
                  key={noteId}
                  value={note.content?.markdown || ""}
                  onSave={handleSave}
                  pageProvider={pageProvider}
                  parentNoteId={noteId}
                  className="h-full"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
