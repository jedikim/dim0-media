import { memo, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ConsoleIcon,
  DeleteIcon,
  FolderIcon,
  LearnWidgetIcon,
  NotepadIcon,
  PdfIcon,
  type AppIconComponent,
} from '@/components/icons'

import { useGraphStore } from '../../store/graph-store'
import type { NoteNode } from '../../types/flow'
import { formatDistanceToNow } from '../../utils/date'


type ListRowMeta = {
  icon: AppIconComponent
  label: string
  onOpen?: () => void
}


/**
 * Keep the list view focused on note-like items that read well as rows.
 */
function isListCompatibleNode(node: NoteNode) {
  return (
    node.data?.style?.type === 'sheet' ||
    node.data?.style?.type === 'widget' ||
    node.data?.style?.type === 'code-sandbox' ||
    node.data?.type === 'document' ||
    node.data?.style?.type === 'folder'
  )
}


/**
 * Sort list-view rows by their persisted list order.
 */
function useSortedListNodes(nodes: NoteNode[]) {
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


/**
 * Resolve the icon, label, and open behavior for a list-view row.
 */
function useListRowMeta(node: NoteNode): ListRowMeta {
  const navigate = useNavigate()
  const boardId = useGraphStore(state => state.boardId)
  const boardCanEdit = useGraphStore(state => state.boardCanEdit)
  const openNodeSurface = useGraphStore(state => state.openNodeSurface)

  if (node.data?.style?.type === 'folder') {
    return {
      icon: FolderIcon,
      label: node.data.label?.markdown?.trim() || 'Untitled folder',
      onOpen: boardId
        ? () => {
            navigate({
              to: '/boards/$id',
              params: { id: boardId },
              search: (prev: Record<string, unknown>) => ({ ...prev, root_id: node.id }),
            })
          }
        : undefined,
    }
  }

  if (node.data?.type === 'document') {
    return {
      icon: PdfIcon,
      label: node.data.label?.markdown?.trim() || 'Untitled document',
    }
  }

  if (node.data?.style?.type === 'widget') {
    return {
      icon: LearnWidgetIcon,
      label: node.data.label?.markdown?.trim() || 'Untitled widget',
      onOpen: boardCanEdit ? () => openNodeSurface(node.id, 'widget') : undefined,
    }
  }

  if (node.data?.style?.type === 'code-sandbox') {
    return {
      icon: ConsoleIcon,
      label: node.data.label?.markdown?.trim() || 'Untitled sandbox',
      onOpen: boardCanEdit ? () => openNodeSurface(node.id, 'code-sandbox') : undefined,
    }
  }

  return {
    icon: NotepadIcon,
    label: node.data.label?.markdown?.trim() || 'Untitled note',
    onOpen: boardCanEdit ? () => openNodeSurface(node.id, 'sheet') : undefined,
  }
}


type ListRowProps = {
  node: NoteNode
  index: number
  isLast: boolean
}


/**
 * Render one lightweight list row with a hanging tree-style connector.
 */
const ListRow = memo(function ListRow({ node, index, isLast }: ListRowProps) {
  const { icon, label, onOpen } = useListRowMeta(node)
  const Icon = icon
  const setNodesPersist = useGraphStore(state => state.setNodesPersist)
  const setEdgesPersist = useGraphStore(state => state.setEdgesPersist)
  const boardCanEdit = useGraphStore(state => state.boardCanEdit)
  const { text: relativeDate, tooltip: fullDate } = formatDistanceToNow(node.data.updatedAt || node.data.createdAt)

  return (
    <div className='group relative pl-12'>
      <div className='pointer-events-none absolute left-0 top-0 h-full w-10'>
        {index > 0 ? (
          <div className='absolute left-5 top-0 bottom-1/2 w-px bg-border/80 transition-colors group-hover:bg-foreground/45' />
        ) : null}
        {!isLast ? (
          <div className='absolute left-5 top-1/2 bottom-0 w-px bg-border/80 transition-colors group-hover:bg-foreground/45' />
        ) : null}
        <div className='absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-bl-md border-b border-l border-border/80 transition-colors group-hover:border-foreground/45' />
      </div>

      <div
        className='select-none flex min-h-11 items-center gap-3 rounded-md border border-transparent px-3 py-2 transition-colors group-hover:border-border/70 group-hover:bg-accent/30'
        onMouseDown={event => {
          if (event.detail > 1) {
            event.preventDefault()
          }
        }}
        onDoubleClick={() => onOpen?.()}
        title={onOpen ? `Double-click to open ${label}` : label}
      >
        <Icon className='size-5 shrink-0 text-muted-foreground' strokeWidth={1.9} />
        <span className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>
          {label}
        </span>
        {relativeDate ? (
          <span
            className='hidden shrink-0 text-xs text-muted-foreground md:block'
            title={fullDate}
          >
            {relativeDate}
          </span>
        ) : null}
        {boardCanEdit ? (
          <button
            type='button'
            onClick={event => {
              event.stopPropagation()
              setNodesPersist(nodes => nodes.filter(candidate => candidate.id !== node.id))
              setEdgesPersist(edges => edges.filter(edge => edge.source !== node.id && edge.target !== node.id))
            }}
            className='opacity-0 transition-opacity group-hover:opacity-100 rounded-md p-1 text-foreground/55 hover:text-destructive'
            aria-label={`Delete ${label}`}
            title='Delete'
          >
            <DeleteIcon className='size-4' strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  )
})


/**
 * Render a lightweight OS-style list of note-like items for the current scope.
 */
export const ListView = memo(function ListView() {
  const nodes = useGraphStore(state => state.nodes)
  const listNodes = useSortedListNodes((nodes as NoteNode[]).filter(isListCompatibleNode))

  return (
    <div className='absolute inset h-full w-full min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin'>
      <div className='mx-auto flex w-full max-w-[880px] flex-col gap-1 px-4 py-8 md:px-8 md:py-20'>
        {listNodes.map((node, index) => (
          <ListRow
            key={node.id}
            node={node}
            index={index}
            isLast={index === listNodes.length - 1}
          />
        ))}
      </div>
    </div>
  )
})
