import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"

import { CancelPlainIcon, DownloadIcon, SparklesIcon } from "@/components/icons"
import { Button } from "@/components/ui/button"

import { useGraphStore } from "../../store/graph-store"
import { SheetEditor } from "../sheet/sheet-editor"
import { createBoardPageProvider } from "../../providers/board-page-provider"
import { useGetNote } from "../../api/get-note"
import { useGetNotePath } from "../../api/get-note-path"
import { useUpdateNote } from "../../api/update-note"
import type { Note } from "../../types/note"
import { SheetBreadcrumb } from "../sheet/sheet-breadcrumb"
import { SheetStackBackground } from "../sheet/sheet-stack-background"


type SheetNodePanelProps = {
  nodeId: string
}


const PANEL_CLASS =
  "absolute left-1/2 -translate-x-1/2 top-4 bottom-4 md:top-20 md:bottom-[96px] w-[min(900px,calc(100vw-2rem))] z-[55] flex flex-col rounded-lg border bg-card shadow-xl overflow-visible"


/**
 * Inline panel for editing a sheet node. Mounts on top of the canvas but
 * leaves the floating island strip clickable underneath.
 */
export const SheetNodePanel = memo(function SheetNodePanel({
  nodeId,
}: SheetNodePanelProps) {
  const navigate = useNavigate()
  const localNote = useGraphStore((state) => state.nodesById.get(nodeId)?.data)
  const activeBoardId = useGraphStore((state) => state.boardId)
  const updateNodeByIdPersist = useGraphStore((state) => state.updateNodeByIdPersist)
  const closeNodeSurface = useGraphStore((state) => state.closeNodeSurface)
  const openNodeSurface = useGraphStore((state) => state.openNodeSurface)
  const setChatSheetOpen = useGraphStore((state) => state.setChatSheetOpen)

  const isLocalNote = !!localNote
  const { data: fetchedNote, isLoading: isFetchingNote } = useGetNote({
    boardId: activeBoardId,
    noteId: nodeId,
    enabled: !isLocalNote && !!activeBoardId,
  })
  const note: Note | undefined = localNote ?? fetchedNote
  const boardId = note?.graphUid ?? activeBoardId

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

  // Close on Escape — only when not editing the title (Escape there cancels).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (titleEditing) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return
      }
      closeNodeSurface()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [closeNodeSurface, titleEditing])

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

  if (!note) {
    if (isFetchingNote) {
      return (
        <div className={`${PANEL_CLASS} items-center justify-center text-sm text-muted-foreground`}>
          Loading note…
        </div>
      )
    }
    return (
      <div className={`${PANEL_CLASS} items-center justify-center gap-3 text-sm text-muted-foreground`}>
        <p>This note doesn’t exist or you don’t have access.</p>
        <Button variant="outline" size="sm" onClick={() => closeNodeSurface()}>
          Close
        </Button>
      </div>
    )
  }

  const displayTitle = note.label?.markdown?.trim() || "Untitled note"
  const stackDepth = Math.max(0, ancestors.length)

  return (
    <div className={PANEL_CLASS}>
      <SheetStackBackground depth={stackDepth} />

      {/* Thin top bar — breadcrumb on the left, actions on the right.
          The title intentionally lives inside the scrollable body below
          (Notion-style) so it reads as the article's H1 instead of chrome. */}
      <div className="w-full flex items-center justify-between gap-2 px-3 py-1.5">
        <div className="min-w-0 flex-1 pr-2">
          <SheetBreadcrumb
            ancestors={ancestors}
            current={note}
            onSegmentClick={(ancestor, kind) => {
              if (kind === "folder") {
                closeNodeSurface()
                if (ancestor.graphUid) {
                  navigate({
                    to: "/boards/$id",
                    params: { id: ancestor.graphUid },
                    search: (prev: Record<string, unknown>) => ({ ...prev, root_id: ancestor.id }),
                  })
                }
                return
              }
              if (kind === "sheet" || kind === "code-sandbox" || kind === "widget") {
                openNodeSurface(ancestor.id, kind)
                return
              }
              if (ancestor.graphUid) {
                closeNodeSurface()
                navigate({
                  to: "/boards/$id",
                  params: { id: ancestor.graphUid },
                  search: (prev: Record<string, unknown>) => prev,
                })
              }
            }}
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Mobile-only AI affordance: the floating island and top bar
              are hidden when a panel covers the screen, so without this
              there's no way to reach the chat sideview from a panel on
              mobile. Hidden on md+ where the floating island is already
              visible underneath. */}
          <button
            type="button"
            onClick={() => setChatSheetOpen(true)}
            title="Open AI chat"
            aria-label="Open AI chat"
            className="md:hidden flex items-center justify-center rounded-md bg-gradient-to-br from-wiki-link to-secondary-foreground size-7 shrink-0 shadow-sm transition hover:brightness-110"
          >
            <SparklesIcon className="size-3.5 text-primary-foreground" weight="fill" />
          </button>
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
          <Button variant="ghost" size="icon-sm" onClick={() => closeNodeSurface()} title="Close" aria-label="Close">
            <CancelPlainIcon className="size-4" />
          </Button>
        </div>
      </div>

      {/* Title is pushed into the editor's *own* scroll container as a
          header slot. That gives us Notion-style behavior — title scrolls
          with the article, status bar stays at the bottom — without two
          scroll containers fighting each other for height. */}
      <SheetEditor
        // Each note is a distinct document; remount when navigating
        // between sheets so TipTap re-initializes for the new doc.
        // Within the same note, content updates flow through MdEditor's
        // own effect (it diffs the prop against the editor's current
        // markdown) so user edits aren't disturbed.
        key={note.id}
        value={note.content?.markdown || ""}
        onSave={handleNoteChange}
        pageProvider={pageProvider}
        parentNoteId={note.id}
        className="flex-1 min-h-0"
        bodyHeader={
          // No horizontal padding here — the parent `.tiptap-editor`
          // already has `padding: 0 1.5rem` and `.ProseMirror` is
          // centered at max-width 720px. Matching that envelope keeps the
          // title's left edge flush with paragraphs / tag panel below.
          <div className="max-w-[720px] mx-auto pb-8">
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
                className="w-full bg-transparent text-3xl md:text-4xl font-bold tracking-tight text-foreground border-0 focus:outline-none px-0 py-0.5"
                placeholder="Untitled note"
              />
            ) : (
              <button
                type="button"
                onClick={() => setTitleEditing(true)}
                className="block w-full text-left text-3xl md:text-4xl font-bold tracking-tight text-foreground hover:opacity-90 transition-opacity"
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
