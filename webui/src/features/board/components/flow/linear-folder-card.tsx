import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { DeleteIcon, FolderIcon } from '@/components/icons'

import type { NoteNode } from '../../types/flow'
import { useGraphStore } from '../../store/graph-store'


type Props = {
  node: NoteNode
}


const normalizeLabel = (markdown?: string) => {
  const text = (markdown ?? '').replace(/\s+/g, ' ').trim()
  return text || 'Untitled folder'
}


/**
 * Files-view card for sub-boards with a centered folder icon and editable title.
 */
export const LinearFolderCard = memo(function LinearFolderCard({ node }: Props) {
  const navigate = useNavigate()
  const boardId = useGraphStore(state => state.boardId)
  const setNodesPersist = useGraphStore(state => state.setNodesPersist)
  const setEdgesPersist = useGraphStore(state => state.setEdgesPersist)
  const updateNodeByIdPersist = useGraphStore(state => state.updateNodeByIdPersist)

  const [labelEditing, setLabelEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(node.data.label?.markdown || '')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const displayLabel = normalizeLabel(node.data.label?.markdown)

  useEffect(() => {
    if (labelEditing) return
    setLabelDraft(node.data.label?.markdown || '')
  }, [labelEditing, node.data.label?.markdown])

  useEffect(() => {
    if (!labelEditing) return
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [labelEditing])

  const commitLabel = useCallback((nextRaw: string) => {
    const next = nextRaw.trim()
    const prev = node.data.label?.markdown?.trim() || ''
    if (next === prev) return
    updateNodeByIdPersist(node.id, prevNode => ({
      ...prevNode,
      data: {
        ...prevNode.data,
        label: next ? { markdown: next } : undefined,
      },
    }))
  }, [node.data.label?.markdown, node.id, updateNodeByIdPersist])

  const stopLabelEdit = useCallback((save: boolean) => {
    if (save) commitLabel(labelDraft)
    else setLabelDraft(node.data.label?.markdown || '')
    setLabelEditing(false)
  }, [commitLabel, labelDraft, node.data.label?.markdown])

  const onDelete = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (!boardId) return
    setNodesPersist(nodes => nodes.filter(n => n.id !== node.id))
    setEdgesPersist(edges => edges.filter(e => e.source !== node.id && e.target !== node.id))
  }, [boardId, node.id, setEdgesPersist, setNodesPersist])

  return (
    <div className='group relative w-full min-w-0'>
      <button
        type='button'
        onClick={onDelete}
        className='absolute right-2 top-2 z-20 p-1 rounded-md text-foreground/60 hover:text-destructive transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
        aria-label='Delete folder'
        title='Delete'
      >
        <DeleteIcon className='size-4' strokeWidth={2} />
      </button>

      <button
        type='button'
        onDoubleClick={() => {
          if (!boardId) return
          navigate({
            to: '/boards/$id',
            params: { id: boardId },
            search: (prev: Record<string, unknown>) => ({ ...prev, root_id: node.id }),
          })
        }}
        className='w-full min-h-[100px] max-h-[225px] rounded-md border-2 border-transparent bg-transparent transition-colors group-hover:bg-accent group-hover:border-border flex items-center justify-center p-3'
      >
        <div className='flex w-full max-w-[92px] aspect-square items-center justify-center rounded-2xl border border-border/70 bg-background text-muted-foreground shadow-sm'>
          <FolderIcon className='size-12 shrink-0' strokeWidth={1.8} />
        </div>
      </button>

      <div className='mt-2 px-2'>
        {labelEditing ? (
          <input
            ref={inputRef}
            value={labelDraft}
            onChange={event => setLabelDraft(event.target.value)}
            onBlur={() => stopLabelEdit(true)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                stopLabelEdit(true)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                stopLabelEdit(false)
              }
            }}
            onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
            className='w-full bg-transparent text-center text-sm font-sans font-semibold text-foreground border-0 border-b border-foreground/30 focus:border-secondary-foreground focus:outline-none px-0 py-0.5'
            placeholder='Untitled folder'
          />
        ) : (
          <button
            type='button'
            onMouseDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              setLabelEditing(true)
            }}
            className='block w-full truncate text-center text-sm font-sans font-semibold text-foreground hover:underline'
            title={displayLabel}
          >
            {displayLabel}
          </button>
        )}
      </div>
    </div>
  )
})
