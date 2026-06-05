import { useRef } from "react"
import { NotepadIcon } from "@phosphor-icons/react"
import { type NodeId } from "@canvas-harness/core"
import { useCanvasStore, useNode } from "@canvas-harness/react"
import { IconPropertyView } from "@/components/icons/icon-property-view"
import { MarkdownView } from "@/components/markdown/markdown-view"
import { cn } from "@/lib/utils"
import type { NoteNodeData } from "../../convert/note-to-node"
import {
  NodeTitleCaption,
  NodeTrafficLights,
  useIsInView,
  useStopCanvasGesture,
} from "../../shared-views"
import { useBoardAppStore } from "../../store/board-app-store"


export type SheetViewProps = {
  id: NodeId
}


/**
 * Cap the body markdown handed to MarkdownView. Parse + layout cost
 * grows linearly with content length, and the inline preview only
 * needs to read as a rich snippet — full content opens in the modal
 * editor surface. Trailing ellipsis hints at "more below".
 */
const PREVIEW_CHAR_LIMIT = 800


const truncate = (body: string): string =>
  body.length <= PREVIEW_CHAR_LIMIT ? body : `${body.slice(0, PREVIEW_CHAR_LIMIT)}…`


/**
 * Sheet inline view — sticky-note style card. Whole body is the click
 * target (opens the editor surface). Editable title sits below.
 *
 * Preview content renders only when the card intersects the viewport
 * (`useIsInView`) to avoid spinning markdown parse / KaTeX / Shiki
 * cost on every off-screen sheet at high zoom. LOD-zoom gating from
 * the lib already suppresses the React view entirely below ~0.4 zoom.
 */
export function SheetView({ id }: SheetViewProps) {
  const node = useNode(id)
  const store = useCanvasStore()
  const openNodeSurface = useBoardAppStore((s) => s.openNodeSurface)
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const bodyRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  useStopCanvasGesture(bodyRef)
  // 200px margin so a pan barely off-screen doesn't blink the preview
  // out — matches the widget view's threshold.
  const isInView = useIsInView(wrapRef, "200px")
  if (!node) return null

  const data = (node.data ?? {}) as Partial<NoteNodeData>
  const label = data.label?.markdown
  const body = node.content?.trim() ?? ""
  const iconValue = data.properties?.iconData?.icon ?? null

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none relative h-full w-full select-none"
    >
      {/*
        Not a <button> — MarkdownView renders Streamdown code blocks
        with their own button children (download, copy), and nested
        <button> is invalid HTML / hydration error. role="button" +
        keyboard handlers keep the same UX without the constraint.
      */}
      <div
        ref={bodyRef}
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onClick={(e) => {
          e.stopPropagation()
          if (!canEdit) return
          openNodeSurface(id as unknown as string, "sheet")
        }}
        onKeyDown={(e) => {
          if (!canEdit) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.stopPropagation()
            openNodeSurface(id as unknown as string, "sheet")
          }
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn(
          "absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card text-left text-card-foreground shadow-md",
          "pointer-events-auto",
          canEdit ? "cursor-pointer" : "cursor-default",
        )}
        title={canEdit ? "Open sheet" : undefined}
      >
        <div className="scrollbar-thin min-h-0 flex-1 overflow-hidden px-4 pb-3 pt-10 text-sm leading-relaxed text-foreground">
          {iconValue && (
            <div className="pointer-events-none mb-2">
              <IconPropertyView icon={iconValue} size={24} />
            </div>
          )}
          {body && isInView ? (
            // pointer-events-none so links / images inside the preview
            // don't intercept the card's click → surface-open handler.
            <div className="pointer-events-none">
              <MarkdownView content={truncate(body)} />
            </div>
          ) : body ? (
            // Off-screen: skip markdown parse, show a dimmed "paused"
            // placeholder so the card still reads as a sheet at a glance.
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <NotepadIcon className="size-5 shrink-0" />
              <span className="text-xs">Sheet paused</span>
            </div>
          ) : (
            <span className="italic text-muted-foreground">Empty sheet</span>
          )}
        </div>
      </div>

      <NodeTrafficLights
        onDelete={canEdit ? () => store.removeNode(id) : undefined}
        onExpand={canEdit ? () => openNodeSurface(id as unknown as string, "sheet") : undefined}
      />

      <div className="pointer-events-auto absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2">
        <NodeTitleCaption
          nodeId={id}
          label={label}
          placeholder="Untitled"
          textClassName="text-center text-sm font-handwriting text-foreground"
        />
      </div>
    </div>
  )
}
