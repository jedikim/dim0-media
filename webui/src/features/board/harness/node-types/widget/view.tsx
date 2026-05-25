import { useRef } from "react"
import { ArrowsOutSimpleIcon, LayoutIcon } from "@phosphor-icons/react"
import type { NodeId } from "@canvas-harness/core"
import { useNode } from "@canvas-harness/react"
import { cn } from "@/lib/utils"
import { WidgetIframe } from "@/features/board/components/flow/widget-iframe"
import type { NoteNodeData } from "../../convert/note-to-node"
import {
  NodeDragHandle,
  NodeTitleCaption,
  useIsInView,
  useStopCanvasGesture,
} from "../../shared-views"
import { useBoardAppStore } from "../../store/board-app-store"


export type WidgetViewProps = {
  id: NodeId
}


/**
 * Widget inline view — sandboxed iframe rendering `node.content` as
 * HTML, with an expand button top-right that opens the full editor.
 * The iframe is dropped when the node scrolls fully off-screen
 * (useIsInView) to free its event loop. Pan/zoom suspension is
 * handled by the canvas placeholder (drawWidgetPlaceholder); this
 * component only mounts at idle.
 */
export function WidgetView({ id }: WidgetViewProps) {
  const node = useNode(id)
  const openNodeSurface = useBoardAppStore((s) => s.openNodeSurface)
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const expandRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  useStopCanvasGesture(expandRef)
  const isInView = useIsInView(wrapRef, "200px")
  if (!node) return null

  const data = (node.data ?? {}) as Partial<NoteNodeData>
  const label = data.label?.markdown
  const html = node.content ?? ""

  return (
    <div
      ref={wrapRef}
      className="pointer-events-none relative h-full w-full select-none"
    >
      <div
        className={cn(
          "absolute inset-0 flex flex-col overflow-hidden rounded-3xl border border-dashed border-border bg-background p-2",
        )}
      >
        <div className="relative h-full w-full overflow-hidden rounded-2xl border border-border/50 bg-background">
          {html && isInView ? (
            <WidgetIframe
              html={html}
              title="Widget"
              className="pointer-events-auto h-full w-full bg-transparent"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
              <LayoutIcon className="size-5 shrink-0" />
              <span>{html ? "Widget paused" : "Widget HTML will render here"}</span>
            </div>
          )}
        </div>
      </div>

      {canEdit ? (
        <button
          ref={expandRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openNodeSurface(id as unknown as string, "widget")
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="pointer-events-auto absolute right-2 top-2 z-20 inline-flex size-7 items-center justify-center rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
          title="Open widget"
          aria-label="Open widget"
        >
          <ArrowsOutSimpleIcon className="size-4" />
        </button>
      ) : null}

      <NodeDragHandle />

      <div className="pointer-events-auto absolute left-1/2 top-full z-20 mt-2 w-full -translate-x-1/2">
        <NodeTitleCaption
          nodeId={id}
          label={label}
          placeholder="Untitled widget"
          textClassName="text-center text-sm font-handwriting text-foreground"
        />
      </div>
    </div>
  )
}
