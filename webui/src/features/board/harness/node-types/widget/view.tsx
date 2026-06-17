import { useRef } from "react"
import { LayoutIcon } from "@phosphor-icons/react"
import { type NodeId } from "@canvas-harness/core"
import { useCanvasStore, useNode, useSelection } from "@canvas-harness/react"
import { cn } from "@/lib/utils"
import { WidgetIframe } from "@/features/board/components/flow/widget-iframe"
import type { NoteNodeData } from "../../convert/note-to-node"
import {
  NodeTitleCaption,
  NodeTrafficLights,
  useIsInView,
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
  const store = useCanvasStore()
  const openNodeSurface = useBoardAppStore((s) => s.openNodeSurface)
  const canEdit = useBoardAppStore((s) => s.canEdit)
  const wrapRef = useRef<HTMLDivElement>(null)
  const isInView = useIsInView(wrapRef, "200px")
  // Gate iframe interaction on selection so canvas pan/zoom gestures
  // pass through unselected widgets cleanly — without this the
  // iframe's `pointer-events-auto` captures the pointer mid-drag and
  // the canvas gesture dies. See mini-app/view.tsx for the same
  // pattern.
  const selection = useSelection()
  const isSelected = selection.includes(id)
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
          "absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-dashed border-border bg-background px-2 pb-2 pt-10",
        )}
      >
        <div className="relative h-full w-full overflow-hidden rounded-xl border border-border/50 bg-background">
          {html && isInView ? (
            <WidgetIframe
              html={html}
              title="Widget"
              className={cn(
                "h-full w-full bg-transparent",
                isSelected ? "pointer-events-auto" : "pointer-events-none",
              )}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
              <LayoutIcon className="size-5 shrink-0" />
              <span>{html ? "Widget paused" : "Widget HTML will render here"}</span>
            </div>
          )}
        </div>
      </div>

      <NodeTrafficLights
        onDelete={canEdit ? () => store.removeNode(id) : undefined}
        onExpand={canEdit ? () => openNodeSurface(id as unknown as string, "widget") : undefined}
      />

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
