import { useCallback, useEffect, useMemo, useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { type CanvasStore, type Node, type NodeId } from "@canvas-harness/core"
import { useCanvasStore } from "@canvas-harness/react"
import { ChevronRightIcon, DragGripIcon, PresentationIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import { useHarnessAddFrame } from "../canvas/use-add-frame"
import { previewSlide } from "../canvas/use-presentation-mode"
import { useHarnessWrapRef } from "../canvas/wrap-ref-context"
import { useBoardAppStore } from "../store/board-app-store"
import type { NoteNodeData } from "../convert/note-to-node"


/**
 * Subscribe to the store's frame list. `getFrames()` returns a fresh
 * array on every call (lib-maintained presentation order), so we
 * mirror the lib's own `useEdges` pattern — `useState` + a `change`
 * subscription — instead of `useSyncExternalStore`, which would loop
 * on the unstable snapshot.
 */
const useFrames = (store: CanvasStore): Node[] => {
  const [frames, setFrames] = useState<Node[]>(() => store.getFrames())
  useEffect(() => {
    setFrames(store.getFrames())
    return store.subscribe("change", () => setFrames(store.getFrames()))
  }, [store])
  return frames
}


/**
 * Display label for a slide — prefer the user-set `slideName` from
 * the Note properties when present, otherwise fall back to position
 * (1-based) so newly-created slides read naturally.
 */
const labelFor = (frame: Node, index: number): string => {
  const data = frame.data as Partial<NoteNodeData> | undefined
  const explicit = data?.properties?.slideName?.text
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit
  return `Slide ${index + 1}`
}


const rowButtonClass =
  "transition-colors text-card-foreground hover:bg-secondary hover:text-secondary-foreground border border-border px-3 py-1.5 rounded-lg text-xs font-medium"


/**
 * Right-side sheet listing the board's frames as presentable slides.
 * Drag-drop reorders via the lib's `setFrameOrder` (single undoable
 * op, syncs over collab). "Add Slide" inserts a frame at the viewport
 * center; "Present" enters presentation mode anchored on the first
 * slide. Clicking a row previews the slide (camera fit) without
 * presenting.
 */
export function SlidesPanel() {
  const store = useCanvasStore()
  const wrapRef = useHarnessWrapRef()
  const boardId = useBoardAppStore((s) => s.boardId)
  const rootId = useBoardAppStore((s) => s.rootId)
  const setSlidesPanelOpen = useBoardAppStore((s) => s.setSlidesPanelOpen)
  const setActiveSlideId = useBoardAppStore((s) => s.setActiveSlideId)
  const setPresentationMode = useBoardAppStore((s) => s.setPresentationMode)
  const activeSlideId = useBoardAppStore((s) => s.activeSlideId)
  const addFrame = useHarnessAddFrame(store, boardId, rootId, wrapRef)

  const frames = useFrames(store)
  const ids = useMemo(() => frames.map((f) => f.id as unknown as string), [frames])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = ids.indexOf(active.id as string)
      const newIndex = ids.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return
      const next = arrayMove(ids, oldIndex, newIndex) as NodeId[]
      store.setFrameOrder(next)
    },
    [ids, store],
  )

  const handleAddSlide = useCallback(() => {
    const id = addFrame()
    if (id) setActiveSlideId(id as unknown as string)
  }, [addFrame, setActiveSlideId])

  const handlePresent = useCallback(() => {
    const first = store.getFrames()[0]
    if (!first) return
    setActiveSlideId(first.id as unknown as string)
    setPresentationMode(true)
    setSlidesPanelOpen(false)
  }, [store, setActiveSlideId, setPresentationMode, setSlidesPanelOpen])

  const handleRowClick = useCallback(
    (id: string) => {
      setActiveSlideId(id)
      previewSlide(store, wrapRef?.current ?? null, id as NodeId)
    },
    [store, wrapRef, setActiveSlideId],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-sidebar px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => setSlidesPanelOpen(false)}
            aria-label="Close slides panel"
            className="rounded-md p-1 transition hover:bg-sidebar-primary/30"
          >
            <ChevronRightIcon className="size-4 text-muted-foreground" />
          </button>
          Slides
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={rowButtonClass} onClick={handleAddSlide}>
            Add Slide
          </button>
          <button
            type="button"
            className={rowButtonClass}
            onClick={handlePresent}
            disabled={frames.length === 0}
          >
            <PresentationIcon className="mr-1 inline-block size-4" />
            Present
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2 p-3">
              {frames.map((frame, i) => (
                <SortableSlideRow
                  key={frame.id as unknown as string}
                  id={frame.id as unknown as string}
                  label={labelFor(frame, i)}
                  active={(frame.id as unknown as string) === activeSlideId}
                  onClick={handleRowClick}
                />
              ))}
              {frames.length === 0 && (
                <div className="px-2 py-6 text-sm text-muted-foreground">
                  No slides yet. Click "Add Slide" to create one.
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}


type SortableSlideRowProps = {
  id: string
  label: string
  active: boolean
  onClick: (id: string) => void
}


function SortableSlideRow({ id, label, active, onClick }: SortableSlideRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2",
        "transition-colors hover:bg-sidebar-primary/30",
        active && "ring-1 ring-secondary-foreground/60",
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="cursor-grab rounded-md p-1 text-muted-foreground/50 transition hover:text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
        onClick={(e) => e.preventDefault()}
      >
        <DragGripIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => onClick(id)}
        className="flex-1 text-left text-sm"
      >
        {label}
      </button>
    </div>
  )
}
