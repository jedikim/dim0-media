import { memo, useEffect, useState } from "react"
import type { Viewport } from "@xyflow/react"
import clsx from "clsx"

import { useShallow } from "zustand/react/shallow"

import { DragGripIcon, ExpandIcon, LayoutIcon } from "@/components/icons"
import { useGraphStore } from "../../store/graph-store"
import type { Note } from "../../types/note"
import { NodeTitleCaption } from "./node-title-caption"
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
  const html = note.content?.markdown?.trim() || ""
  const scopeViewportKey = boardId ? `${boardId}:${rootId ?? "root"}` : undefined
  const viewport = scopeViewportKey ? graphViewports[scopeViewportKey] : undefined
  const [isVisibleInViewport, setIsVisibleInViewport] = useState(true)

  useEffect(() => {
    if (isMoving) return
    setIsVisibleInViewport(isNoteInViewport(note, viewport, rendererSize))
  }, [isMoving, note, rendererSize, viewport])

  const suspendPreview = Boolean(isMoving || dragging || !isVisibleInViewport)
  const canInteractInline = selected && !suspendPreview

  return (
    <div
      className="relative w-full h-full overflow-visible rounded-3xl border border-border border-dashed bg-background p-2 text-left"
    >
      <NodeTitleCaption
        nodeId={note.id}
        label={note.label?.markdown}
        placeholder="Untitled widget"
        textClassName="text-center text-sm font-medium text-foreground"
        className="absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2"
      />

      <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
        <div
          className="drag-handle flex size-8 cursor-grab items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
          title="Drag widget"
          aria-label="Drag widget"
        >
          <DragGripIcon className="size-4 shrink-0" />
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
            <ExpandIcon className="size-4 shrink-0" />
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
            <LayoutIcon className="size-5 shrink-0" />
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
