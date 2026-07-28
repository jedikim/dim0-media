import { useRef, useState } from "react"
import { ArrowsOutSimpleIcon, XIcon } from "@phosphor-icons/react"
import { DragGripIcon } from "@/components/icons"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { useEmbeddedDragHandle } from "./embedded-node-view-context"
import { useStopCanvasGesture } from "./use-stop-canvas-gesture"


export type NodeTrafficLightsProps = {
  /** Optional. When omitted the red dot is not rendered. */
  onDelete?: () => void
  /**
   * When set, the red dot opens a confirm dialog with this copy and only fires
   * `onDelete` once the user confirms. Use for durable (non-undoable) deletes.
   */
  confirmDelete?: { title: string; description: string }
  /** Optional. When omitted the green dot is not rendered. */
  onExpand?: () => void
  className?: string
}


/**
 * Header strip with the macOS-style trio of colored dots (red / yellow
 * / green) for delete / drag / expand. Per-dot hover grows the dot
 * into a full button with its icon.
 *
 * The strip itself is a full-width hit zone with `cursor-grab`: the
 * empty area to the right of the dots is a click-to-select / drag
 * target for the node, so users can grab the node without triggering
 * the body's open-surface click. Body click still opens the dialog;
 * strip click selects.
 *
 * Mount as a SIBLING of the node body — never a child. The strip and
 * the yellow dot carry NO event handlers so pointerdown bubbles
 * untouched to the canvas wrap, letting canvas-harness's gesture
 * system run select-and-drag. Red and green are real buttons that
 * stop canvas gestures so their clicks fire instead.
 *
 * In an embedded surface (e.g. Files cards) the strip still renders,
 * but its root absorbs drag-handle props from the embedding context
 * (e.g. dnd-kit attributes/listeners) so it becomes the parent
 * surface's reorder handle instead of a canvas-select target.
 */
export function NodeTrafficLights({
  onDelete,
  confirmDelete,
  onExpand,
  className,
}: NodeTrafficLightsProps) {
  const dragHandleProps = useEmbeddedDragHandle()
  const deleteRef = useRef<HTMLButtonElement>(null)
  const expandRef = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState(false)
  useStopCanvasGesture(deleteRef)
  useStopCanvasGesture(expandRef)

  // Confirmed deletes route through the dialog; plain deletes fire immediately.
  const handleDelete = (): void => {
    if (confirmDelete) setConfirming(true)
    else onDelete?.()
  }

  return (
    <>
    <div
      {...dragHandleProps}
      title="Drag to move · click to select"
      className={cn(
        "pointer-events-auto absolute inset-x-0 top-0 z-30",
        "flex h-10 items-center px-3",
        "cursor-grab touch-none active:cursor-grabbing",
        className,
      )}
    >
      {onDelete ? (
        <button
          ref={deleteRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleDelete()
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label="Delete"
          title="Delete"
          className="group/dot flex size-5 cursor-pointer items-center justify-center"
        >
          <span
            className={cn(
              "flex size-3 items-center justify-center rounded-full",
              "bg-rose-400/90 dark:bg-rose-500/90",
              "shadow-sm transition-all duration-150",
              "group-hover/dot:size-5",
            )}
          >
            <XIcon
              weight="bold"
              className="size-3 text-rose-50 opacity-0 transition-opacity duration-150 group-hover/dot:opacity-100"
            />
          </span>
        </button>
      ) : null}

      <div
        aria-hidden="true"
        className="group/dot flex size-5 items-center justify-center"
      >
        <span
          className={cn(
            "flex size-3 items-center justify-center rounded-full",
            "bg-amber-300/90 dark:bg-amber-400/90",
            "shadow-sm transition-all duration-150",
            "group-hover/dot:size-5",
          )}
        >
          <DragGripIcon className="size-3 text-amber-900 opacity-0 transition-opacity duration-150 group-hover/dot:opacity-100" />
        </span>
      </div>

      {onExpand ? (
        <button
          ref={expandRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onExpand()
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label="Open"
          title="Open"
          className="group/dot flex size-5 cursor-pointer items-center justify-center"
        >
          <span
            className={cn(
              "flex size-3 items-center justify-center rounded-full",
              "bg-emerald-400/90 dark:bg-emerald-500/90",
              "shadow-sm transition-all duration-150",
              "group-hover/dot:size-5",
            )}
          >
            <ArrowsOutSimpleIcon
              weight="bold"
              className="size-3 text-emerald-50 opacity-0 transition-opacity duration-150 group-hover/dot:opacity-100"
            />
          </span>
        </button>
      ) : null}
    </div>

    {confirmDelete ? (
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDelete.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDelete.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false)
                onDelete?.()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    ) : null}
    </>
  )
}
