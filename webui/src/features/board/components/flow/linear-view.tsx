import { useMemo, useEffect, useState } from 'react'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Grip } from 'lucide-react'
import { useGraphStore } from '../../store/graph-store'
import type { NoteNode } from '../../types/flow'
import { LinearNoteCard } from './linear-note-card'
import { LinearDocumentCard } from './linear-document-card'
import { LinearFolderCard } from './linear-folder-card'
import { LinearWidgetCard } from './linear-widget-card'
import { LinearCodeSandboxCard } from './linear-code-sandbox-card'
import { useUpdateNote } from '../../api/update-note'
import type { NumberProperty } from '@/features/newsfeed/types/properties'
import { useAppStore } from '@/store'

export type LinearViewProps = {
  cols?: number            // desired columns for >= breakpoint
  gapPx?: number           // grid gap in px
  mobileBreakpointPx?: number // < this width → 1 column (default 640 = Tailwind 'sm')
  maxWidthPx?: number      // container max width
}

function useSortedNodes(nodes: NoteNode[]) {
  return useMemo(
    () =>
      [...nodes].sort(
        (a, b) =>
          (a.data.properties.listOrder.number ?? 0) -
          (b.data.properties.listOrder.number ?? 0)
      ),
    [nodes]
  )
}

// snaps to 2 columns on small screens using matchMedia
function useEffectiveCols(cols: number, breakpointPx: number) {
  const get = () => {
    if (typeof window === 'undefined') return cols
    return window.innerWidth < breakpointPx ? Math.min(2, cols) : cols
  }
  const [effective, setEffective] = useState<number>(get)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 0.5}px)`)
    const update = () => setEffective(mq.matches ? Math.min(2, cols) : cols)
    update()
    mq.addEventListener('change', update)
    return () => {
      mq.removeEventListener('change', update)
    }
  }, [cols, breakpointPx])

  return effective
}


/**
 * Compute the smallest set of list-order changes needed after a drag.
 */
function buildListOrderUpdates(
  reorderedNodes: NoteNode[],
  movedNodeId: string,
  movedIndex: number
): Map<string, number> {
  const updates = new Map<string, number>()
  const previousNode = reorderedNodes[movedIndex - 1] ?? null
  const nextNode = reorderedNodes[movedIndex + 1] ?? null

  if (!previousNode && !nextNode) {
    updates.set(movedNodeId, 0)
    return updates
  }

  if (!previousNode && nextNode) {
    updates.set(movedNodeId, (nextNode.data.properties.listOrder.number ?? 0) - 100)
    return updates
  }

  if (previousNode && !nextNode) {
    updates.set(movedNodeId, (previousNode.data.properties.listOrder.number ?? 0) + 100)
    return updates
  }

  const previousOrder = previousNode?.data.properties.listOrder.number ?? 0
  const nextOrder = nextNode?.data.properties.listOrder.number ?? 0

  if (previousOrder === nextOrder) {
    for (let index = movedIndex + 1; index < reorderedNodes.length; index += 1) {
      const node = reorderedNodes[index]
      const currentOrder = node.data.properties.listOrder.number ?? 0
      updates.set(node.id, currentOrder + 100)
    }
  }

  const shiftedNextOrder = updates.get(nextNode!.id) ?? nextOrder
  updates.set(movedNodeId, (previousOrder + shiftedNextOrder) / 2)

  return updates
}

export function LinearView({
  cols = 4,
  gapPx = 16,
  mobileBreakpointPx = 640,
  maxWidthPx = 1000
}: LinearViewProps) {
  const userId = useAppStore(state => state.userId)
  const nodes = useGraphStore(state => state.nodes)
  const setNodes = useGraphStore(state => state.setNodes)
  const boardId = useGraphStore(state => state.boardId)
  const { updateNote } = useUpdateNote()

  const sortedNodes = useSortedNodes(
    (nodes as NoteNode[]).filter(n =>
      n.data?.style?.type === 'sheet' ||
      n.data?.style?.type === 'widget' ||
      n.data?.style?.type === 'code-sandbox' ||
      n.data?.type === 'document' ||
      n.data?.style?.type === 'folder'
    )
  )
  const ids = useMemo(() => sortedNodes.map(n => n.id), [sortedNodes])

  const effectiveCols = useEffectiveCols(cols, mobileBreakpointPx)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = ids.indexOf(active.id as string)
    const newIndex = ids.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(sortedNodes, oldIndex, newIndex)
    if (!userId || !boardId) return
    const nextOrderValues = buildListOrderUpdates(newOrder, active.id as string, newIndex)

    const updatedNodes = nodes.map(n => {
      const nextListOrder = nextOrderValues.get(n.id)
      if (nextListOrder === undefined) return n
      const newNode = {
        ...n,
        data: {
          ...n.data,
          properties: {
            ...n.data.properties,
            listOrder: {
              type: 'number',
              number: nextListOrder
            } as NumberProperty
          }
        }
      }
      updateNote({ boardId, noteId: n.id, noteData: newNode.data })
      return newNode
    })

    setNodes(updatedNodes)
  }

  return (
    <div className='w-full'>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div
            className='grid p-4 mx-auto'
            style={{
              maxWidth: maxWidthPx,
              columnGap: gapPx,
              rowGap: gapPx,
              gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))`
            }}
          >
            {sortedNodes.map(n => (
              <SortableNoteCard key={n.id} node={n} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

type SortableNoteCardProps = {
  node: NoteNode
}

function SortableNoteCard({ node }: SortableNoteCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: node.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.7 : 1,
    minWidth: 0
  }

  return (
    <div ref={setNodeRef} style={style} className='relative'>
      <button
        {...attributes}
        {...listeners}
        aria-label='Drag to reorder'
        className='absolute left-1 top-1 z-30 p-1 rounded-md cursor-grab active:cursor-grabbing touch-none text-foreground/50 hover:text-foreground transition'
        onClick={e => e.preventDefault()}
      >
        <Grip className='size-4' />
      </button>

      {node.data?.style?.type === 'folder' ? (
        <LinearFolderCard node={node} />
      ) : node.data?.style?.type === 'widget' ? (
        <LinearWidgetCard node={node} />
      ) : node.data?.style?.type === 'code-sandbox' ? (
        <LinearCodeSandboxCard node={node} />
      ) : node.data?.type === 'document' ? (
        <LinearDocumentCard node={node} />
      ) : (
        <LinearNoteCard node={node} />
      )}
    </div>
  )
}
