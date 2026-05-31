import { memo, useCallback, useEffect, useMemo, useState } from "react"
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Node, NodeId } from "@canvas-harness/core"
import { useCanvasStore } from "@canvas-harness/react"
import { useDocumentLikeNodes } from "../canvas/use-document-like-nodes"
import { CodeSandboxView } from "../node-types/code-sandbox"
import { DocumentView } from "../node-types/document"
import { FolderView } from "../node-types/folder"
import { SheetView } from "../node-types/sheet"
import { WidgetView } from "../node-types/widget"
import type { NoteNodeData } from "../convert/note-to-node"
import { EmbeddedNodeViewProvider } from "../shared-views"


/** Default grid columns at desktop widths; collapses to 2 on phones. */
const DESKTOP_COLS = 3
const MOBILE_BREAKPOINT_PX = 640
const COLUMN_GAP_PX = 24
// Title caption sits below the card via `absolute top-full mt-2` and can
// wrap to 2-3 lines. Row gap accommodates that overflow so titles never
// collide with the next row's card.
const ROW_GAP_PX = 72
const MAX_WIDTH_PX = 1280
const CARD_HEIGHT_PX = 240


/**
 * Snap to 2 columns under the mobile breakpoint. Subscribes to a
 * matchMedia so column count tracks window resizes.
 */
const useEffectiveCols = (cols: number, breakpointPx: number): number => {
  const read = () =>
    typeof window === "undefined"
      ? cols
      : window.innerWidth < breakpointPx
        ? Math.min(2, cols)
        : cols
  const [effective, setEffective] = useState<number>(read)
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 0.5}px)`)
    const update = () =>
      setEffective(mq.matches ? Math.min(2, cols) : cols)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [cols, breakpointPx])
  return effective
}


/**
 * Dispatch a node to the existing harness React view by type. Reuses
 * the same SheetView / FolderView / etc. components that render on
 * the canvas — single source of truth for each type's appearance, no
 * separate LinearXCard variants to maintain.
 */
const NodeViewFor = ({ node }: { node: Node }): React.ReactElement | null => {
  const id = node.id as NodeId
  switch (node.type) {
    case "sheet":
      return <SheetView id={id} />
    case "folder":
      return <FolderView id={id} />
    case "widget":
      return <WidgetView id={id} />
    case "code-sandbox":
      return <CodeSandboxView id={id} />
    case "document":
      return <DocumentView id={id} />
    default:
      return null
  }
}


type SortableCardProps = {
  node: Node
}


/**
 * One sortable grid cell. dnd-kit's `attributes` + `listeners` are
 * forwarded through `EmbeddedNodeViewProvider` so the inner
 * `NodeTrafficLights` strip itself becomes the reorder drag handle —
 * single chrome shared with the canvas view, no standalone grip.
 */
const SortableCard = memo(function SortableCard({ node }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: node.id as unknown as string })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.7 : 1,
    minWidth: 0,
    height: CARD_HEIGHT_PX,
  }
  const dragHandleProps = useMemo(
    () => ({ ...attributes, ...listeners }),
    [attributes, listeners],
  )
  return (
    <div ref={setNodeRef} style={style} className="relative w-full">
      <EmbeddedNodeViewProvider dragHandleProps={dragHandleProps}>
        <NodeViewFor node={node} />
      </EmbeddedNodeViewProvider>
    </div>
  )
})


/**
 * Files view — responsive grid of document-like nodes (sheet /
 * widget / code-sandbox / document / folder). Each cell hosts the
 * same React view used on the canvas, so behavior (open, rename,
 * preview rendering) stays consistent across modes.
 *
 * Drag-handle reorders via `store.updateNode` for affected nodes
 * inside one batch — save loop POSTs the diff. `listOrder` is the
 * persisted sort key.
 */
export const LinearView = memo(function LinearView() {
  const store = useCanvasStore()
  const nodes = useDocumentLikeNodes(store)
  const ids = useMemo(
    () => nodes.map((n) => n.id as unknown as string),
    [nodes],
  )
  const cols = useEffectiveCols(DESKTOP_COLS, MOBILE_BREAKPOINT_PX)

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
      const reordered = arrayMove(nodes, oldIndex, newIndex)
      store.batch(() => {
        reordered.forEach((node, i) => {
          const data = (node.data ?? {}) as NoteNodeData
          const prev = data.properties?.listOrder?.number ?? 0
          const next = i + 1
          if (prev === next) return
          store.updateNode(node.id as NodeId, {
            data: {
              ...data,
              properties: {
                ...data.properties,
                listOrder: { type: "number", number: next },
              },
            },
          })
        })
      })
    },
    [ids, nodes, store],
  )

  return (
    <div className="absolute inset-0 h-full w-full overflow-y-auto overflow-x-hidden scrollbar-thin">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div
            className="mx-auto grid px-4 pb-8 pt-28 md:px-8 md:pb-16 md:pt-32"
            style={{
              maxWidth: MAX_WIDTH_PX,
              columnGap: COLUMN_GAP_PX,
              rowGap: ROW_GAP_PX,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            }}
          >
            {nodes.length === 0 ? (
              <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
                Nothing here yet. Add a note, folder, or document from the toolbar.
              </div>
            ) : (
              nodes.map((node) => (
                <SortableCard key={node.id as unknown as string} node={node} />
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
})
