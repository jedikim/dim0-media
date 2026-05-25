import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useCanvasStore, useNode } from "@canvas-harness/react"
import type { NodeId } from "@canvas-harness/core"
import { CancelPlainIcon, DownloadIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { useGetNote } from "@/features/board/api/get-note"
import { useGetNotePath } from "@/features/board/api/get-note-path"
import { useUpdateNote } from "@/features/board/api/update-note"
import { SheetEditor } from "@/features/board/components/sheet/sheet-editor"
import {
  SheetBreadcrumb,
  type BreadcrumbSegmentKind,
} from "@/features/board/components/sheet/sheet-breadcrumb"
import { SheetStackBackground } from "@/features/board/components/sheet/sheet-stack-background"
import { createBoardPageProvider } from "@/features/board/providers/board-page-provider"
import type { Note } from "@/features/board/types/note"
import type { NoteNodeData } from "../../convert/note-to-node"
import { useBoardAppStore } from "../../store/board-app-store"


export type SheetPanelProps = {
  nodeId: string
  onClose: () => void
}


const PANEL_CLASS =
  "absolute left-1/2 -translate-x-1/2 top-4 bottom-4 md:top-20 md:bottom-[96px] w-[min(900px,calc(100vw-2rem))] z-[55] flex flex-col rounded-lg border bg-card shadow-xl overflow-visible"


/**
 * Floating sheet editor — TipTap markdown editor backed by either the
 * canvas-harness store (sheets that live on the current canvas) or a
 * direct REST fetch (sub-pages reached from the editor's `/subpage`
 * slash command, which never enter the local scene). Mirrors prod's
 * local-or-remote pattern in sheet-node-panel.tsx.
 */
export const SheetPanel = memo(function SheetPanel({
  nodeId,
  onClose,
}: SheetPanelProps) {
  const store = useCanvasStore()
  const navigate = useNavigate()
  const localNode = useNode(nodeId as NodeId)
  const localData = (localNode?.data ?? {}) as Partial<NoteNodeData>
  const activeBoardId = useBoardAppStore((s) => s.boardId)
  const openNodeSurface = useBoardAppStore((s) => s.openNodeSurface)

  const isLocalNote = !!localNode

  // REST fallback for sheets not present on the current canvas scope
  // (sub-pages reached via the editor's `/subpage` slash command).
  const { data: fetchedNote, isLoading: isFetchingNote } = useGetNote({
    boardId: activeBoardId ?? undefined,
    noteId: nodeId,
    enabled: !isLocalNote && !!activeBoardId,
  })

  // Resolved view of the note — prefer local store, fall back to fetch.
  // `boardId` ends with the note's own graphUid when known, so per-note
  // API calls (path, update, subpages) hit the right graph even for
  // sheets that belong to a different sub-graph.
  const noteLabel = localData.label?.markdown ?? fetchedNote?.label?.markdown
  const noteContent =
    localNode?.content ?? fetchedNote?.content?.markdown ?? ""
  const boardId =
    localData.graphUid ?? fetchedNote?.graphUid ?? activeBoardId ?? null
  const exists = isLocalNote || !!fetchedNote

  const { data: notePath = [] } = useGetNotePath({
    boardId: boardId ?? undefined,
    noteId: nodeId,
    enabled: !!boardId,
  })
  const ancestors = useMemo(() => notePath.slice(0, -1), [notePath])
  const currentSegment: Note | undefined = notePath[notePath.length - 1]

  // Page provider — backs TipTap's /subpage slash command. List/get
  // hit the board API; create inserts a new sheet under this one;
  // onNavigate opens the target subpage as the active surface so
  // clicking a subpage ref inside the editor switches to it.
  const pageProvider = useMemo(() => {
    if (!boardId) return null
    return createBoardPageProvider({
      boardId,
      parentNoteId: nodeId,
      onNavigate: (id) => openNodeSurface(id, "sheet"),
    })
  }, [boardId, nodeId, openNodeSurface])

  const handleSegmentClick = useCallback(
    (note: Note, kind: BreadcrumbSegmentKind) => {
      if (kind === "folder") {
        onClose()
        if (boardId) {
          navigate({
            to: "/boards/$id",
            params: { id: boardId },
            search: (prev: Record<string, unknown>) => ({
              ...prev,
              root_id: note.id,
            }),
          })
        }
        return
      }
      if (kind === "sheet" || kind === "code-sandbox" || kind === "widget") {
        openNodeSurface(note.id, kind)
      }
    },
    [boardId, navigate, onClose, openNodeSurface],
  )

  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(noteLabel ?? "")
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (titleEditing) return
    setTitleDraft(noteLabel ?? "")
  }, [noteLabel, titleEditing])

  useEffect(() => {
    if (!titleEditing) return
    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [titleEditing])

  const { mutate: updateNoteMutate } = useUpdateNote()
  const persistRemote = useCallback(
    (patch: Partial<Note>) => {
      if (!boardId) return
      updateNoteMutate({ boardId, noteId: nodeId, noteData: patch })
    },
    [boardId, nodeId, updateNoteMutate],
  )

  const persistTitle = useCallback(
    (next: string) => {
      const trimmed = next.trim()
      const prev = noteLabel?.trim() ?? ""
      if (trimmed === prev) return
      if (isLocalNote) {
        const prevData = (localNode?.data ?? {}) as Record<string, unknown>
        store.updateNode(nodeId as NodeId, {
          data: {
            ...prevData,
            label: trimmed ? { markdown: trimmed } : undefined,
          },
        })
      } else {
        persistRemote({ label: trimmed ? { markdown: trimmed } : undefined })
      }
    },
    [isLocalNote, localNode?.data, nodeId, noteLabel, persistRemote, store],
  )

  const stopTitleEdit = useCallback(
    (save: boolean) => {
      if (save) persistTitle(titleDraft)
      else setTitleDraft(noteLabel ?? "")
      setTitleEditing(false)
    },
    [persistTitle, titleDraft, noteLabel],
  )

  const handleNoteChange = useCallback(
    (markdown: string) => {
      if (markdown === noteContent) return
      if (isLocalNote) {
        store.updateNode(nodeId as NodeId, { content: markdown })
      } else {
        persistRemote({ content: { markdown } })
      }
    },
    [isLocalNote, noteContent, nodeId, persistRemote, store],
  )

  const handleDownloadMarkdown = useCallback(() => {
    if (!noteContent.trim()) return

    const safeBaseName =
      (noteLabel || "sheet")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "sheet"

    const blob = new Blob([noteContent], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${safeBaseName}.md`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [noteContent, noteLabel])

  // Loading / missing states — only show "no longer exists" once the
  // REST fetch has settled (otherwise sub-pages flash that message
  // before their data arrives).
  if (!exists) {
    if (isFetchingNote) {
      return (
        <div
          className={`${PANEL_CLASS} items-center justify-center text-sm text-muted-foreground`}
        >
          Loading note…
        </div>
      )
    }
    return (
      <div
        className={`${PANEL_CLASS} items-center justify-center gap-3 text-sm text-muted-foreground`}
      >
        <p>This sheet no longer exists.</p>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }

  const displayTitle = noteLabel?.trim() || "Untitled note"

  const stackDepth = Math.max(0, ancestors.length)

  return (
    <div className={PANEL_CLASS} onClick={(e) => e.stopPropagation()}>
      <SheetStackBackground depth={stackDepth} />
      <div className="flex w-full items-center justify-between gap-2 px-3 py-1.5">
        <div className="min-w-0 flex-1 pr-2">
          <SheetBreadcrumb
            ancestors={ancestors}
            current={currentSegment}
            onSegmentClick={handleSegmentClick}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleDownloadMarkdown}
            title="Download markdown"
            aria-label="Download markdown"
            disabled={!noteContent.trim()}
          >
            <DownloadIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <CancelPlainIcon className="size-4" />
          </Button>
        </div>
      </div>

      <SheetEditor
        key={nodeId}
        value={noteContent}
        onSave={handleNoteChange}
        pageProvider={pageProvider}
        parentNoteId={nodeId}
        className="min-h-0 flex-1"
        bodyHeader={
          <div className="mx-auto max-w-[720px] pb-8">
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
                className="w-full border-0 bg-transparent px-0 py-0.5 text-3xl font-bold tracking-tight text-foreground focus:outline-none md:text-4xl"
                placeholder="Untitled note"
              />
            ) : (
              <button
                type="button"
                onClick={() => setTitleEditing(true)}
                className="block w-full text-left text-3xl font-bold tracking-tight text-foreground transition-opacity hover:opacity-90 md:text-4xl"
                title={displayTitle}
              >
                {displayTitle}
              </button>
            )}
          </div>
        }
      />
    </div>
  )
})
