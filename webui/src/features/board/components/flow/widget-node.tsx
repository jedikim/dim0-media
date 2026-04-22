import { memo, useCallback, useEffect, useRef, useState } from "react"
import type { Viewport } from "@xyflow/react"
import clsx from "clsx"

import { DragDropIcon, Layout01Icon, Maximize01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useShallow } from "zustand/react/shallow"

import { useGraphStore } from "../../store/graph-store"
import type { Note } from "../../types/note"
import { WidgetIframe } from "./widget-iframe"


type WidgetNodeProps = {
  note: Note
  selected?: boolean
  dragging?: boolean
}


/**
 * Convert the current viewport transform into graph-space bounds.
 */
const getViewportBounds = (viewport: Viewport, width: number, height: number) => {
  const left = -viewport.x / viewport.zoom
  const top = -viewport.y / viewport.zoom
  const right = (width - viewport.x) / viewport.zoom
  const bottom = (height - viewport.y) / viewport.zoom
  return { left, top, right, bottom }
}


/**
 * Check whether a note rect is fully contained in the current graph viewport.
 */
const isNoteInViewport = (
  note: Note,
  viewport: Viewport | undefined,
  rendererSize: { width: number; height: number } | null,
) => {
  if (!viewport || !rendererSize) return true

  const x = note.properties.nodePosition?.position?.x ?? 0
  const y = note.properties.nodePosition?.position?.y ?? 0
  const width = note.properties.nodeSize?.size?.width ?? 0
  const height = note.properties.nodeSize?.size?.height ?? 0
  const bounds = getViewportBounds(viewport, rendererSize.width, rendererSize.height)

  return x >= bounds.left &&
    y >= bounds.top &&
    x + width <= bounds.right &&
    y + height <= bounds.bottom
}


/**
 * Read-only board preview for widget notes rendered from HTML content.
 */
export const WidgetNode = memo(function WidgetNode({
  note,
  selected = false,
  dragging,
}: WidgetNodeProps) {
  const { boardId, rootId, graphViewports, isMoving, boardCanEdit, rendererSize } = useGraphStore(useShallow((state) => ({
    boardId: state.boardId,
    rootId: state.rootId,
    graphViewports: state.graphViewports,
    isMoving: state.isMoving,
    boardCanEdit: state.boardCanEdit,
    rendererSize: state.rendererSize,
  })))
  const openNodeSurface = useGraphStore((state) => state.openNodeSurface)
  const updateNodeByIdPersist = useGraphStore((state) => state.updateNodeByIdPersist)
  const html = note.content?.markdown?.trim() || ""
  const displayTitle = note.label?.markdown?.trim() || "Untitled widget"
  const scopeViewportKey = boardId ? `${boardId}:${rootId ?? "root"}` : undefined
  const viewport = scopeViewportKey ? graphViewports[scopeViewportKey] : undefined
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(note.label?.markdown || "")
  const [isVisibleInViewport, setIsVisibleInViewport] = useState(true)
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (titleEditing) return
    setTitleDraft(note.label?.markdown || "")
  }, [note.label?.markdown, titleEditing])

  useEffect(() => {
    if (!titleEditing) return
    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [titleEditing])

  useEffect(() => {
    if (isMoving) return
    setIsVisibleInViewport(isNoteInViewport(note, viewport, rendererSize))
  }, [isMoving, note, rendererSize, viewport])

  const suspendPreview = Boolean(isMoving || dragging || !isVisibleInViewport)
  const canInteractInline = selected && !suspendPreview

  /**
   * Persist the edited board title for this widget node.
   */
  const commitTitle = useCallback((nextRaw: string) => {
    const next = nextRaw.trim()
    const prev = note.label?.markdown?.trim() || ""
    if (next === prev) return

    updateNodeByIdPersist(note.id, (node) => ({
      ...node,
      data: {
        ...node.data,
        label: next ? { markdown: next } : undefined,
      },
    }))
  }, [note.id, note.label?.markdown, updateNodeByIdPersist])

  /**
   * End inline title editing, optionally saving the latest draft.
   */
  const stopTitleEdit = useCallback((save: boolean) => {
    if (save) commitTitle(titleDraft)
    else setTitleDraft(note.label?.markdown || "")
    setTitleEditing(false)
  }, [commitTitle, note.label?.markdown, titleDraft])

  return (
    <div
      className="relative w-full h-full overflow-visible rounded-3xl border border-border border-dashed bg-background p-2 text-left"
    >
      <div className="absolute left-1/2 top-full z-20 mt-2 w-full max-w-[220px] -translate-x-1/2">
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
            onPointerDown={(event) => event.stopPropagation()}
            className="nodrag w-full bg-transparent border-0 border-b border-foreground/30 focus:border-secondary focus:outline-none px-0 py-0.5 text-center text-sm font-medium text-foreground"
            placeholder="Untitled widget"
          />
        ) : (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (!boardCanEdit) return
              setTitleEditing(true)
            }}
            className="nodrag block w-full truncate text-center text-sm font-medium text-foreground hover:underline"
            title={displayTitle}
          >
            {displayTitle}
          </button>
        )}
      </div>

      <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
        <div
          className="drag-handle flex size-8 cursor-grab items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
          title="Drag widget"
          aria-label="Drag widget"
        >
          <HugeiconsIcon icon={DragDropIcon} className="size-4 shrink-0" strokeWidth={2} />
        </div>

        {boardCanEdit && (
          <button
            type="button"
            className="nodrag flex size-8 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation()
              openNodeSurface(note.id, "widget")
            }}
            title="Open widget"
            aria-label="Open widget"
          >
            <HugeiconsIcon icon={Maximize01Icon} className="size-4 shrink-0" strokeWidth={2} />
          </button>
        )}
      </div>

      <div
        className={clsx(
          "nodrag h-full w-full overflow-hidden rounded-xl border border-border/50 bg-background",
          canInteractInline ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        {html && !suspendPreview ? (
          <WidgetIframe
            html={html}
            title="Widget"
            className="h-full w-full border-0 bg-transparent"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
            <HugeiconsIcon icon={Layout01Icon} className="size-5 shrink-0" strokeWidth={2} />
            <span>Widget HTML will render here</span>
          </div>
        )}
      </div>
      {suspendPreview && (
        <div className="nodrag absolute inset-0 flex items-center justify-center bg-card/75 backdrop-blur-[1px]">
          <div className="rounded-full border border-border/70 bg-card px-3 py-1 text-base font-medium text-muted-foreground shadow-sm">
            {isMoving || dragging ? "Moving widget..." : "Widget preview paused"}
          </div>
        </div>
      )}
    </div>
  )
})
