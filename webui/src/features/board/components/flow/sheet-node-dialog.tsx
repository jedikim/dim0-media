import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"

import { CancelPlainIcon, DownloadIcon, SheetExternalLinkIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { SheetUrl } from "@/routes"

import { useGraphStore } from "../../store/graph-store"
import { SheetEditor } from "../sheet/sheet-editor"
import { createBoardPageProvider } from "../../providers/board-page-provider"
import { useGetNote } from "../../api/get-note"
import { useGetNotePath } from "../../api/get-note-path"
import { useUpdateNote } from "../../api/update-note"
import type { Note } from "../../types/note"
import { SheetBreadcrumb } from "../sheet/sheet-breadcrumb"
import { SheetStackBackground } from "../sheet/sheet-stack-background"


type SheetNodeDialogProps = {
  nodeId: string
}


/**
 * Rich sheet dialog rendered once at board level for the active sheet node.
 */
export const SheetNodeDialog = memo(function SheetNodeDialog({
  nodeId,
}: SheetNodeDialogProps) {
  const navigate = useNavigate()
  const localNote = useGraphStore((state) => state.nodesById.get(nodeId)?.data)
  const activeBoardId = useGraphStore((state) => state.boardId)
  const updateNodeByIdPersist = useGraphStore((state) => state.updateNodeByIdPersist)
  const closeNodeSurface = useGraphStore((state) => state.closeNodeSurface)
  const openNodeSurface = useGraphStore((state) => state.openNodeSurface)

  // Sub-pages don't live on the canvas (no entry in nodesById), so when
  // the dialog is opened on a note we don't have locally, fall back to the
  // API. The fetched note becomes the source of truth; saves go through
  // the PATCH endpoint instead of the canvas-store mutation.
  const isLocalNote = !!localNote
  const { data: fetchedNote, isLoading: isFetchingNote } = useGetNote({
    boardId: activeBoardId,
    noteId: nodeId,
    enabled: !isLocalNote && !!activeBoardId,
  })
  const note: Note | undefined = localNote ?? fetchedNote
  const boardId = note?.graphUid ?? activeBoardId

  // Ancestor chain for the breadcrumb. The path query is shared across the
  // dialog and full-page view; React Query caches per (boardId, noteId) so
  // jumping to an ancestor is instant after the first load.
  const { data: notePath = [] } = useGetNotePath({
    boardId,
    noteId: nodeId,
    enabled: !!boardId,
  })
  const ancestors = notePath.slice(0, -1)

  const { mutate: updateNoteMutate } = useUpdateNote()
  const persistRemote = useCallback(
    (patch: Partial<Note>) => {
      if (!boardId) return
      updateNoteMutate({ boardId, noteId: nodeId, noteData: patch })
    },
    [boardId, nodeId, updateNoteMutate],
  )

  // Real backend-backed PageProvider for the editor's @-mention picker.
  // Resolves "pages" against the same board the current note lives in;
  // navigation reuses the graph store's openNodeSurface so following a
  // chip simply swaps the dialog to the target sheet.
  const pageProvider = useMemo(() => {
    if (!note?.graphUid) return null
    return createBoardPageProvider({
      boardId: note.graphUid,
      parentNoteId: note.id,
      onNavigate: (id) => openNodeSurface(id, "sheet"),
    })
  }, [note?.graphUid, note?.id, openNodeSurface])

  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(note?.label?.markdown || "")
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!titleEditing) {
      setTitleDraft(note?.label?.markdown || "")
    }
  }, [note?.label?.markdown, titleEditing])

  useEffect(() => {
    if (!titleEditing) return
    const frameId = requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frameId)
  }, [titleEditing])

  const persistTitle = useCallback((title: string) => {
    if (!note) return
    if (isLocalNote) {
      updateNodeByIdPersist(note.id, (node) => ({
        ...node,
        data: {
          ...node.data,
          label: { markdown: title },
        },
      }))
      return
    }
    persistRemote({ label: { markdown: title } })
  }, [note, isLocalNote, persistRemote, updateNodeByIdPersist])

  const stopTitleEdit = useCallback((save: boolean) => {
    if (!note) return
    if (save) {
      persistTitle(titleDraft)
    } else {
      setTitleDraft(note.label?.markdown || "")
    }
    setTitleEditing(false)
  }, [note, persistTitle, titleDraft])

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) return
    if (titleEditing) {
      stopTitleEdit(true)
    }
    closeNodeSurface()
  }, [closeNodeSurface, stopTitleEdit, titleEditing])

  const handleNoteChange = useCallback((markdown: string) => {
    if (!note) return
    if (isLocalNote) {
      updateNodeByIdPersist(note.id, (node) => ({
        ...node,
        data: {
          ...node.data,
          content: { markdown },
        },
      }))
      return
    }
    persistRemote({ content: { markdown } })
  }, [note, isLocalNote, persistRemote, updateNodeByIdPersist])

  const handleOpenFullView = useCallback(() => {
    if (!note?.graphUid) return
    navigate({ to: SheetUrl, params: { id: note.graphUid, noteId: note.id } })
  }, [navigate, note?.graphUid, note?.id])

  /**
   * Download the current sheet markdown as a local .md file.
   */
  const handleDownloadMarkdown = useCallback(() => {
    const markdown = note?.content?.markdown || ""
    if (!markdown.trim()) return

    const safeBaseName = (note?.label?.markdown || "sheet")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "sheet"

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${safeBaseName}.md`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [note?.content?.markdown, note?.label?.markdown])

  // Loading and not-found states for sub-pages (which start empty in the
  // canvas store). Local notes always have `note` already, so these only
  // ever render for the API-loaded path.
  if (!note) {
    if (isFetchingNote) {
      return (
        <Dialog open onOpenChange={handleOpenChange}>
          <DialogContent
            className="sm:max-w-4xl h-3/4 flex items-center justify-center text-sm text-muted-foreground"
            showCloseButton={false}
          >
            <DialogTitle className="sr-only">Loading sheet</DialogTitle>
            Loading note…
          </DialogContent>
        </Dialog>
      )
    }
    return (
      <Dialog open onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-4xl h-3/4 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Note unavailable</DialogTitle>
          <p>This note doesn’t exist or you don’t have access.</p>
          <Button variant="outline" size="sm" onClick={() => closeNodeSurface()}>
            Close
          </Button>
        </DialogContent>
      </Dialog>
    )
  }

  const displayTitle = note.label?.markdown?.trim() || "Untitled note"

  const stackDepth = Math.max(0, ancestors.length)

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-4xl h-3/4 flex flex-col items-center text-left p-2 overflow-visible"
        showCloseButton={false}
      >
        <SheetStackBackground depth={stackDepth} />
        <div className="w-full flex items-center justify-between gap-2 px-2 pt-1">
          <div className="min-w-0 flex-1 pr-2 flex flex-col gap-0.5">
            <SheetBreadcrumb
              ancestors={ancestors}
              onSegmentClick={(id) => openNodeSurface(id, "sheet")}
            />
            {titleEditing ? (
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => stopTitleEdit(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    stopTitleEdit(true)
                  }
                  if (event.key === "Escape") {
                    event.preventDefault()
                    stopTitleEdit(false)
                  }
                }}
                className="w-full bg-transparent text-sm font-semibold text-foreground border-0 border-b border-foreground/30 focus:border-secondary-foreground focus:outline-none px-0 py-0.5"
                placeholder="Untitled note"
              />
            ) : (
              <button
                type="button"
                onClick={() => setTitleEditing(true)}
                className="block max-w-full truncate text-left text-sm font-semibold text-foreground hover:underline"
                title={displayTitle}
              >
                {displayTitle}
              </button>
            )}
            <DialogTitle className="sr-only">Sheet</DialogTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDownloadMarkdown}
              title="Download markdown"
              aria-label="Download markdown"
              disabled={!note.content?.markdown?.trim()}
            >
              <DownloadIcon className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={handleOpenFullView} title="Open full view" aria-label="Open full view">
              <SheetExternalLinkIcon className="size-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => handleOpenChange(false)} title="Close" aria-label="Close">
              <CancelPlainIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 flex items-center w-full h-full min-h-0 min-w-0">
          <div className="h-full w-full min-w-0 overflow-y-auto overflow-x-hidden scrollbar-thin">
            <SheetEditor
              // Each note is a distinct document; remount the editor when
              // navigating between sheets (e.g. clicking a subpage card)
              // so TipTap re-initializes with the target note's content.
              key={note.id}
              value={note.content?.markdown || ""}
              onSave={handleNoteChange}
              pageProvider={pageProvider}
              parentNoteId={note.id}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
})
