import { DragGripIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import { useIsEmbeddedNodeView } from "./embedded-node-view-context"


export type NodeDragHandleProps = {
  className?: string
}


/**
 * Small grip-icon button sitting on the top-left of a custom-node
 * React view. Its sole purpose is to give the user a grab target that
 * forwards pointer events to canvas-harness's gesture system — so
 * clicking selects, dragging moves the node.
 *
 * Implementation note: this MUST be rendered as a sibling of the
 * node's body button (NOT a child). The body uses
 * `useStopCanvasGesture` to keep its own clicks from reaching the
 * canvas; if the handle bubbled through the body, those listeners
 * would swallow the pointerdown too. Mounted as a sibling, the handle
 * sits visually on top via z-index, captures the hover cursor, and
 * lets pointerdown bubble straight to the canvas wrap.
 *
 * Do not add `useStopCanvasGesture`, `onPointerDown`, or anything else
 * that consumes events here — that's the whole point.
 */
export const NodeDragHandle = ({ className }: NodeDragHandleProps) => {
  // Suppress when the view is mounted inside a non-canvas surface
  // (Files cards already own a drag handle on their parent cell).
  const embedded = useIsEmbeddedNodeView()
  if (embedded) return null
  return (
    <div
      aria-label="Drag node"
      title="Drag to move · click to select"
      className={cn(
        "pointer-events-auto absolute left-2 top-2 z-30",
        "inline-flex size-6 items-center justify-center rounded-md",
        "border border-border/60 bg-background/80 text-muted-foreground/70 shadow-sm",
        "transition-colors hover:bg-accent hover:text-foreground",
        "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      <DragGripIcon className="size-4" />
    </div>
  )
}
