// components/flow/linear-note-card.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NoteNode } from '../../types/flow'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useGraphStore } from '../../store/graph-store'
import { DeleteIcon, PaintBoardIcon, PinIcon, PinOffIcon } from '@/components/icons'
import clsx from 'clsx'
import { TAILWIND_300 } from '../../lib/colors/tailwind'
import { formatDistanceToNow } from '../../utils/date'
import { useTheme } from '@/components/theme-provider'
import { darkModeDisplayHex } from '../../lib/colors/dark-variants'
import { DocumentCardView } from './document-card-view'
import type { NoteWithPin } from './note-card'


type Props = { node: NoteNode }

export function LinearNoteCard({ node }: Props) {
  const [titleEditing, setTitleEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.data.label?.markdown || '')
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  const boardId = useGraphStore(state => state.boardId)
  const boardCanEdit = useGraphStore(state => state.boardCanEdit)
  const openNodeSurface = useGraphStore(state => state.openNodeSurface)

  const setNodesPersist = useGraphStore(state => state.setNodesPersist)
  const updateNodeByIdPersist = useGraphStore(state => state.updateNodeByIdPersist)
  const setEdgesPersist = useGraphStore(state => state.setEdgesPersist)

  // dark mode support
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const color = isDark ? darkModeDisplayHex(node.data.style.backgroundColor) ?? '#a5c9ff' : node.data.style.backgroundColor
  const textColor = isDark
    ? darkModeDisplayHex(node.data.style.textColor) ?? undefined
    : node.data.style.textColor
  const isPinned = node.data.properties.pinned.boolean
  const isSheet = node.data.style.type === 'sheet'
  const isCodeSandbox = node.data.style.type === 'code-sandbox'
  const isWidget = node.data.style.type === 'widget'
  const usesHostedSurface = isSheet || isCodeSandbox || isWidget
  const title = node.data.label?.markdown?.trim() || ''
  const displayTitle = title || 'Untitled note'
  const { text: timeAgo, tooltip: fullDate } = formatDistanceToNow(node.data.updatedAt)

  useEffect(() => {
    if (titleEditing) return
    setTitleDraft(node.data.label?.markdown || '')
  }, [node.data.label?.markdown, titleEditing])

  const onSaveTitle = useCallback((nextTitle: string) => {
    if (!boardId) return
    const normalizedTitle = nextTitle.trim()
    updateNodeByIdPersist(node.id, prev => ({
      ...prev,
      data: {
        ...prev.data,
        label: normalizedTitle ? { markdown: normalizedTitle } : undefined,
        updatedAt: new Date().toISOString(),
      },
    }))
  }, [boardId, node.id, updateNodeByIdPersist])

  const startTitleEdit = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setTitleDraft(node.data.label?.markdown || '')
    setTitleEditing(true)
    requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
  }, [node.data.label?.markdown])

  const stopTitleEdit = useCallback((save: boolean) => {
    if (save) onSaveTitle(titleDraft)
    else setTitleDraft(node.data.label?.markdown || '')
    setTitleEditing(false)
  }, [node.data.label?.markdown, onSaveTitle, titleDraft])

  const onPickColor = useCallback((hex: string) => {
    if (!boardId) return
    const newNode = {
      ...node,
      data: { ...node.data, style: { ...node.data.style, backgroundColor: hex } }
    } as NoteNode
    setNodesPersist(nds =>
      nds.map(n => n.id === node.id ? newNode : n)
    )
  }, [boardId, node, setNodesPersist])

  const onTogglePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!boardId) return
    const noteProperties = { ...node.data.properties, pinned: { type: "boolean", boolean: !isPinned } }
    const newNode = { ...node, data: { ...node.data, properties: noteProperties } } as NoteNode
    setNodesPersist(nds =>
      nds.map(n => n.id === node.id ? newNode : n)
    )
  }, [boardId, isPinned, node, setNodesPersist])

  const onDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!boardId) return
    setNodesPersist(nodes => nodes.filter(n => n.id !== node.id))
    setEdgesPersist(edges => edges.filter(e => e.source !== node.id && e.target !== node.id))
  }, [boardId, node.id, setNodesPersist, setEdgesPersist])

  const handleOpenSurface = useCallback(() => {
    if (!boardCanEdit) return
    openNodeSurface(node.id, isCodeSandbox ? 'code-sandbox' : isWidget ? 'widget' : 'sheet')
  }, [boardCanEdit, isCodeSandbox, isWidget, node.id, openNodeSurface])

  const cardClass = clsx(
    'transition rounded-lg relative transition-all duration-200 group',
    usesHostedSurface && boardCanEdit && 'cursor-pointer',
    isSheet
      ? null
      : clsx(
        'overflow-hidden bg-background sticky-note-shadow paper-note-texture p-0.5',
        isPinned
          ? 'ring-2 ring-secondary-foreground/60'
          : 'hover:ring-2 hover:ring-secondary-foreground/40',
      ),
  )

  const cardBackground = isSheet ? undefined : color
  const CardBody = useMemo(() => (
    <div className={cardClass} style={cardBackground ? { backgroundColor: cardBackground } : undefined}>
      {!isSheet && (
        <div
          className='absolute top-0 inset-x-0 z-20 rounded-t-sm border-b border-foreground/60 pointer-events-none transition-opacity opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto'
          style={cardBackground ? { backgroundColor: cardBackground } : undefined}
        >
          <div className='px-1.5 py-1 w-full h-full flex items-center justify-end gap-1'>
            <div className='flex flex-row items-center gap-2 px-1'>
              {timeAgo && fullDate && (
                <div className=''>
                  <span title={fullDate} className='text-xs text-muted-foreground select-none'>
                    {timeAgo}
                  </span>
                </div>
              )}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className='p-1 text-foreground/80 hover:text-foreground transition-colors'
                  aria-label='Change background color'
                  title='Change background color'
                  onClick={e => e.stopPropagation()}
                >
                  <PaintBoardIcon className='size-4 shrink-0' strokeWidth={2} />
                </button>
              </PopoverTrigger>
              <PopoverContent align='start' className='w-auto p-2'>
                <div className='grid grid-cols-6 gap-2'>
                  {[{ name: 'white', hex: '#ffffff' }, ...TAILWIND_300].map(c => (
                    <button
                      key={c.name}
                      className='h-6 w-6 rounded-md border border-border hover:brightness-95'
                      style={{ backgroundColor: isDark ? darkModeDisplayHex(c.hex) || c.hex : c.hex }}
                      title={`${c.name}-100`}
                      aria-label={`${c.name}-100`}
                      onClick={() => onPickColor(c.hex)}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <button
              className='p-1 text-foreground/80 hover:text-foreground transition-colors'
              onClick={onTogglePin}
              aria-label='Toggle pin'
              title='Pin/Unpin'
            >
              {isPinned
                ? <PinIcon className='w-4 h-4 text-secondary-foreground' strokeWidth={2} />
                : <PinOffIcon className='w-4 h-4' strokeWidth={2} />
              }
            </button>
            <button
              className='p-1 text-foreground/80 hover:text-destructive transition-colors'
              onClick={onDelete}
              aria-label='Delete note'
              title='Delete'
            >
              <DeleteIcon className='w-4 h-4' strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      {/* content area */}
      <div
        className={clsx(
          'relative z-10 text-foreground',
          isSheet
            ? 'h-[220px]'
            : 'p-2 pt-8 min-h-[100px] max-h-[300px] overflow-x-hidden overflow-y-auto scrollbar-thin space-y-1',
        )}
        onClick={() => {
          if (isSheet) return
          if (usesHostedSurface) {
            handleOpenSurface()
          }
        }}
      >
        {isSheet ? (
          <DocumentCardView
            note={node.data as NoteWithPin}
            selected={false}
            isDark={isDark}
            isPinned={Boolean(isPinned)}
            textColor={textColor}
            onTogglePin={onTogglePin}
            onDelete={onDelete}
            onOpen={handleOpenSurface}
            hideBadge
          />
        ) : isCodeSandbox ? (
          <pre className='whitespace-pre-wrap break-all font-mono text-sm leading-5 text-foreground/90'>
            {node.data.content?.markdown || '# Write Python here'}
          </pre>
        ) : isWidget ? (
          <div className='h-full min-h-[140px] overflow-hidden rounded-md border border-border/60 bg-card'>
            <iframe
              title='Widget preview'
              srcDoc={node.data.content?.markdown || ''}
              sandbox='allow-scripts'
              loading='lazy'
              referrerPolicy='no-referrer'
              className='pointer-events-none h-full w-full border-0 bg-white'
            />
          </div>
        ) : (
          <div className='prose dark:prose-invert max-w-none min-w-0 origin-top-left scale-[0.64] w-[156.25%]'>
            <MarkdownView content={node.data.content?.markdown || ''} />
          </div>
        )}
      </div>
    </div>
  ), [
    cardBackground,
    cardClass,
    fullDate,
    isDark,
    isCodeSandbox,
    isPinned,
    isSheet,
    handleOpenSurface,
    node.data,
    onDelete,
    onPickColor,
    onTogglePin,
    textColor,
    timeAgo,
    usesHostedSurface,
    isWidget,
  ])

  const CardShell = (
    <div className='relative w-full min-w-0'>
      <div>
        {CardBody}
      </div>
      <div className='mt-2 px-2'>
        {usesHostedSurface ? (
          <button
            type='button'
            onClick={handleOpenSurface}
            className={clsx(
              'block w-full truncate text-center text-sm font-semibold text-foreground',
              boardCanEdit && 'hover:underline'
            )}
            title={isCodeSandbox ? 'Python sandbox' : displayTitle}
          >
            {isCodeSandbox ? 'Python sandbox' : displayTitle}
          </button>
        ) : titleEditing ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={() => stopTitleEdit(true)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                stopTitleEdit(true)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                stopTitleEdit(false)
              }
            }}
            onClick={e => e.stopPropagation()}
            className='w-full bg-transparent text-center text-sm font-semibold text-foreground border-0 border-b border-foreground/30 focus:border-secondary-foreground focus:outline-none px-0 py-0.5'
            placeholder='Untitled note'
          />
        ) : (
          <button
            type='button'
            onClick={startTitleEdit}
            className='block w-full truncate text-center text-sm font-semibold text-foreground hover:underline'
            title={displayTitle}
          >
            {displayTitle}
          </button>
        )}
      </div>
    </div>
  )

  return CardShell
}
