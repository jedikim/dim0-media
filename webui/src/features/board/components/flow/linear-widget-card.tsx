import { memo, useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'

import { Analytics02Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { useGraphStore } from '../../store/graph-store'
import type { NoteNode } from '../../types/flow'


type Props = {
  node: NoteNode
}


/**
 * Files-view card for widget notes with an inline title and lightweight icon preview.
 */
export const LinearWidgetCard = memo(function LinearWidgetCard({ node }: Props) {
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.data.label?.markdown || '')
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  const boardId = useGraphStore(state => state.boardId)
  const boardCanEdit = useGraphStore(state => state.boardCanEdit)
  const openNodeSurface = useGraphStore(state => state.openNodeSurface)
  const setNodesPersist = useGraphStore(state => state.setNodesPersist)
  const setEdgesPersist = useGraphStore(state => state.setEdgesPersist)
  const updateNodeByIdPersist = useGraphStore(state => state.updateNodeByIdPersist)

  const displayTitle = node.data.label?.markdown?.trim() || 'Untitled widget'

  useEffect(() => {
    if (titleEditing) return
    setTitleDraft(node.data.label?.markdown || '')
  }, [node.data.label?.markdown, titleEditing])

  useEffect(() => {
    if (!titleEditing) return
    const frame = requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [titleEditing])

  /**
   * Persist the edited title into the widget note label.
   */
  const onSaveTitle = useCallback((nextTitle: string) => {
    const normalizedTitle = nextTitle.trim()
    const prev = node.data.label?.markdown?.trim() || ''
    if (normalizedTitle === prev) return

    updateNodeByIdPersist(node.id, prevNode => ({
      ...prevNode,
      data: {
        ...prevNode.data,
        label: normalizedTitle ? { markdown: normalizedTitle } : undefined,
        updatedAt: new Date().toISOString(),
      },
    }))
  }, [node.data.label?.markdown, node.id, updateNodeByIdPersist])

  /**
   * End title editing, optionally saving the draft.
   */
  const stopTitleEdit = useCallback((save: boolean) => {
    if (save) onSaveTitle(titleDraft)
    else setTitleDraft(node.data.label?.markdown || '')
    setTitleEditing(false)
  }, [node.data.label?.markdown, onSaveTitle, titleDraft])

  const onDelete = useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (!boardId) return
    setNodesPersist(nodes => nodes.filter(n => n.id !== node.id))
    setEdgesPersist(edges => edges.filter(e => e.source !== node.id && e.target !== node.id))
  }, [boardId, node.id, setEdgesPersist, setNodesPersist])

  const handleOpenSurface = useCallback(() => {
    if (!boardCanEdit) return
    openNodeSurface(node.id, 'widget')
  }, [boardCanEdit, node.id, openNodeSurface])

  return (
    <div className='group relative w-full min-w-0'>
      <button
        type='button'
        onClick={onDelete}
        className='absolute right-2 top-2 z-30 p-1 rounded-md text-foreground/60 hover:text-destructive transition-colors opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
        aria-label='Delete widget'
        title='Delete'
      >
        <HugeiconsIcon icon={Delete02Icon} className='size-4' strokeWidth={2} />
      </button>

      <button
        type='button'
        onClick={handleOpenSurface}
        title='Open widget'
        aria-label={`Open widget ${displayTitle}`}
        className={clsx(
          'w-full min-h-[100px] max-h-[225px] rounded-md border-2 border-transparent bg-transparent text-left transition-colors flex items-center justify-center p-3',
          boardCanEdit && 'hover:bg-accent hover:border-border'
        )}
      >
        <div className='flex w-full max-w-[92px] aspect-square items-center justify-center rounded-2xl border border-border/70 bg-background text-muted-foreground shadow-sm'>
          <HugeiconsIcon icon={Analytics02Icon} className='size-12 shrink-0' strokeWidth={1.8} />
        </div>
      </button>

      <div className='mt-2 px-2'>
        {titleEditing ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={event => setTitleDraft(event.target.value)}
            onBlur={() => stopTitleEdit(true)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                stopTitleEdit(true)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                stopTitleEdit(false)
              }
            }}
            onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
            className='w-full bg-transparent text-center text-sm font-semibold text-foreground border-0 border-b border-foreground/30 focus:border-secondary focus:outline-none px-0 py-0.5'
            placeholder='Untitled widget'
          />
        ) : (
          <button
            type='button'
            onMouseDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              setTitleEditing(true)
            }}
            className='block w-full truncate text-center text-sm font-semibold text-foreground hover:underline'
            title={displayTitle}
          >
            {displayTitle}
          </button>
        )}
      </div>
    </div>
  )
})
