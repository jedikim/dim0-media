import { memo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ChatHistoryIcon,
  ChevronDownIcon,
  CircleClusterIcon,
  CircleShapeIcon,
  CodeFileIcon,
  ConnectorPathIcon,
  CursorSelectIcon,
  DiamondShapeIcon,
  DocumentFileIcon,
  EllipsisIcon,
  FolderPlusActionIcon,
  GraphViewIcon,
  GridViewIcon,
  HandGrabIcon,
  HandPanIcon,
  ImageStackIcon,
  LayerStackIcon,
  LearnWidgetIcon,
  ListViewIcon,
  NotepadIcon,
  PresentationIcon,
  PuzzlePieceIcon,
  ShapesMenuIcon,
  ShareIcon,
  SquareShapeIcon,
  TagIcon,
  TextTIcon,
  WeatherCloudIcon,
} from '@/components/icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import clsx from 'clsx'

import type { AddNoteNodeOptions } from '../../hooks/use-add-node'
import type { NodeType } from '../../types/style'
import { useGraphStore } from '../../store/graph-store'


type ViewMode = 'graph' | 'linear' | 'list'


type Props = {
  onAddNode: (options: AddNoteNodeOptions) => void
  onAddLine: () => void
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  enableSelection: boolean
  setEnableSelection: (mode: boolean) => void
  openShapeMenu: boolean
  setOpenShapeMenu: (open: boolean) => void
  setOpenIconSearch: (open: boolean) => void
  setOpenImageSearch: (open: boolean) => void
  setOpenDocumentUpload: (open: boolean) => void
  setOpenChatDialog: (open: boolean) => void
  chatOpen: boolean
  onToggleSlidesPanel: () => void
  slidesPanelOpen: boolean
  boardId?: string
  boardVisibility: 'private' | 'public'
  onUpdateVisibility: (visibility: 'private' | 'public') => Promise<void>
}


export const TopBar = memo(function TopBar({
  onAddNode,
  onAddLine,
  viewMode,
  setViewMode,
  enableSelection,
  setEnableSelection,
  openShapeMenu,
  setOpenShapeMenu,
  setOpenIconSearch,
  setOpenImageSearch,
  setOpenDocumentUpload,
  setOpenChatDialog,
  chatOpen,
  onToggleSlidesPanel,
  slidesPanelOpen,
  boardId,
  boardVisibility,
  onUpdateVisibility,
}: Props) {
  const currentFolderDepth = useGraphStore(state => state.currentFolderDepth)
  const maxFolderDepth = useGraphStore(state => state.maxFolderDepth)
  const isAtMaxFolderDepth = currentFolderDepth >= maxFolderDepth
  const normalButtonClass = 'transition-colors text-card-foreground hover:bg-secondary hover:text-secondary-foreground !p-2.5 rounded-lg flex items-center justify-center gap-2'
  const activeButtonClass = clsx(normalButtonClass, 'bg-secondary text-secondary-foreground')
  const [openShareDialog, setOpenShareDialog] = useState(false)
  const [isUpdatingSharing, setIsUpdatingSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  /**
   * Render tooltip content with an optional keyboard shortcut hint.
   */
  const renderTooltipContent = (label: string, shortcut?: string) => (
    <TooltipContent side='bottom' sideOffset={10}>
      <div className='flex items-center gap-2'>
        <span>{label}</span>
        {shortcut ? <span className='text-[10px] uppercase tracking-widest text-muted-foreground'>{shortcut}</span> : null}
      </div>
    </TooltipContent>
  )

  /**
   * Render a compact keyboard hint badge in the corner of an icon button.
   */
  const renderButtonShortcut = (shortcut: string) => (
    <span className='pointer-events-none absolute -bottom-1 -right-1 px-0 text-[9px] font-semibold leading-none text-muted-foreground/80'>
      {shortcut}
    </span>
  )

  const shapeOptions: { nodeType: NodeType; label: string; icon: React.ReactNode; shortcut?: string }[] = [
    { nodeType: 'rectangle', label: 'Rectangle', icon: <SquareShapeIcon className='size-4 shrink-0' /> , shortcut: 'R' },
    { nodeType: 'layered-rectangle', label: 'Layered card', icon: <LayerStackIcon className='w-4 h-4 shrink-0' /> },
    { nodeType: 'ellipse', label: 'Ellipse', icon: <CircleShapeIcon className='size-4 shrink-0' />, shortcut: 'O' },
    { nodeType: 'diamond', label: 'Diamond', icon: <DiamondShapeIcon className='size-4 shrink-0' />, shortcut: 'D' },
    { nodeType: 'soft-diamond', label: 'Double diamond', icon: <DiamondShapeIcon className='size-4 shrink-0' />, shortcut: 'D' },
    { nodeType: 'layered-diamond', label: 'Layered diamond', icon: <LayerStackIcon className='w-4 h-4 shrink-0' /> },
    { nodeType: 'layered-circle', label: 'Layered circle', icon: <CircleClusterIcon className='size-4 shrink-0' /> },
    { nodeType: 'tag', label: 'Tag', icon: <TagIcon className='size-4 shrink-0' /> },
    { nodeType: 'thought-cloud', label: 'Cloud', icon: <WeatherCloudIcon className='w-4 h-4 shrink-0' /> },
    { nodeType: 'capsule', label: 'Capsule', icon: <TagIcon className='size-4 shrink-0' /> },
  ]

  const tooltipCopy = {
    view: 'Change view',
    graph: 'Graph view',
    files: 'Files view',
    list: 'List view',
    pan: 'Pan mode',
    select: 'Selection mode',
    note: 'Note',
    folder: isAtMaxFolderDepth
      ? `Max Sub-board depth reached (${maxFolderDepth})`
      : 'Sub-board',
    document: 'Upload document',
    shape: 'Shapes',
    connector: 'Connector',
    text: 'Text',
    assistant: 'Assistant',
    slides: 'Slides',
    share: 'Share board',
    more: 'More actions',
  }

  const isPublicShared = boardVisibility === 'public'
  const currentViewLabel = viewMode === 'graph' ? 'Board' : viewMode === 'linear' ? 'Files' : 'List'

  const handleTogglePublicShare = async () => {
    if (!boardId || isUpdatingSharing) return
    setShareError(null)
    setIsUpdatingSharing(true)
    try {
      await onUpdateVisibility(isPublicShared ? 'private' : 'public')
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not update sharing')
    } finally {
      setIsUpdatingSharing(false)
    }
  }

  const handleCopyShareLink = async () => {
    if (!boardId) return
    const url = `${window.location.origin}/boards/${boardId}`
    try {
      await navigator.clipboard.writeText(url)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not copy link')
    }
  }

  return (
    <div
      className='absolute z-50 border border-border/60 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-sidebar/80 backdrop-saturate-150 bg-sidebar text-sidebar-foreground rounded-xl p-1 flex gap-1 right-2 top-1/2 -translate-y-1/2 flex-col items-center max-h-[82vh] overflow-y-auto md:left-1/2 md:right-auto md:top-2 md:-translate-x-1/2 md:-translate-y-0 md:flex-row md:items-center md:max-h-none md:overflow-visible'
      role='toolbar'
      aria-label='Board top bar'
    >
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant={null} size='default' className={activeButtonClass}>
                {viewMode === 'graph'
                  ? <GraphViewIcon className='size-4 shrink-0' weight='fill' />
                  : viewMode === 'linear'
                    ? <GridViewIcon className='size-4 shrink-0' weight='fill' />
                    : <ListViewIcon className='size-4 shrink-0' weight='fill' />
                }
                <span className='sr-only md:not-sr-only text-[10px]'>{currentViewLabel}</span>
                <ChevronDownIcon className='hidden size-3 shrink-0 text-muted-foreground md:block' />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side='bottom' sideOffset={10}>{tooltipCopy.view}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align='start' side='bottom' sideOffset={8} className='min-w-[160px]'>
          <DropdownMenuItem onSelect={() => setViewMode('graph')} className='gap-2 text-sm'>
            <GraphViewIcon className='size-4 shrink-0' />
            <span>Board</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setViewMode('linear')} className='gap-2 text-sm'>
            <GridViewIcon className='size-4 shrink-0' />
            <span>Files</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setViewMode('list')} className='gap-2 text-sm'>
            <ListViewIcon className='size-4 shrink-0' />
            <span>List</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className='md:!h-6 hidden md:block' />

      {viewMode === 'graph' && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={null} size='icon' onClick={() => setEnableSelection(!enableSelection)} className={enableSelection ? normalButtonClass : activeButtonClass} aria-label='Pan mode'>
                <div className='relative'>
                  {enableSelection
                    ? <HandPanIcon className='size-4 shrink-0' />
                    : <HandGrabIcon className='size-4 shrink-0' weight='fill' />
                  }
                  {renderButtonShortcut('P')}
                </div>
              </Button>
            </TooltipTrigger>
            {renderTooltipContent(tooltipCopy.pan, 'P')}
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={null} size='icon' onClick={() => setEnableSelection(!enableSelection)} className={enableSelection ? activeButtonClass : normalButtonClass} aria-label='Selection mode'>
                <div className='relative'>
                  <CursorSelectIcon className='size-4 shrink-0' weight={enableSelection ? 'fill' : undefined} />
                  {renderButtonShortcut('V')}
                </div>
              </Button>
            </TooltipTrigger>
            {renderTooltipContent(tooltipCopy.select, 'V')}
          </Tooltip>

          <Separator orientation="vertical" className='md:!h-6 hidden md:block' />

          <DropdownMenu open={openShapeMenu} onOpenChange={setOpenShapeMenu}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant={null} className={normalButtonClass} size='icon' aria-label='Add shape'>
                    <div className='flex flex-col items-center gap-0.5 relative'>
                      <ShapesMenuIcon className='size-4 shrink-0' />
                      {renderButtonShortcut('S')}
                      <ChevronDownIcon className='absolute inset-x-0 -bottom-3.5 w-3 h-3 text-muted-foreground' />
                    </div>
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              {renderTooltipContent(tooltipCopy.shape, 'S')}
            </Tooltip>
            <DropdownMenuContent align='center' side='bottom' sideOffset={8} className='min-w-[180px]'>
              {shapeOptions.map(option => (
                <DropdownMenuItem key={option.nodeType} onSelect={() => onAddNode({ nodeType: option.nodeType })} className='gap-2 text-sm'>
                  {option.icon}
                  <span>{option.label}</span>
                  {option.shortcut ? <DropdownMenuShortcut>{option.shortcut}</DropdownMenuShortcut> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={null} className={normalButtonClass} size='icon' onClick={onAddLine} aria-label='Add connector'>
                <div className='relative'>
                  <ConnectorPathIcon className='size-4 shrink-0' />
                  {renderButtonShortcut('A')}
                </div>
              </Button>
            </TooltipTrigger>
            {renderTooltipContent(tooltipCopy.connector, 'A')}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={null} className={normalButtonClass} size='icon' onClick={() => onAddNode({ nodeType: 'text' })} aria-label='Add point text'>
                <div className='relative'>
                  <TextTIcon className='size-4 shrink-0' />
                  {renderButtonShortcut('T')}
                </div>
              </Button>
            </TooltipTrigger>
            {renderTooltipContent(tooltipCopy.text, 'T')}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={null}
                className={normalButtonClass}
                size='icon'
                onClick={() => onAddNode({ nodeType: 'sheet' })}
                aria-label='Add note'
              >
                <div className='relative'>
                  <NotepadIcon className='size-4 shrink-0' />
                  {renderButtonShortcut('N')}
                </div>
              </Button>
            </TooltipTrigger>
            {renderTooltipContent(tooltipCopy.note, 'N')}
          </Tooltip>

          <Separator orientation="vertical" className='md:!h-6 hidden md:block' />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={null}
                className={slidesPanelOpen ? activeButtonClass : normalButtonClass}
                size='icon'
                onClick={onToggleSlidesPanel}
                aria-label='Slides'
                disabled={!boardId}
              >
                <div className='relative'>
                  <PresentationIcon className='size-4 shrink-0' weight={slidesPanelOpen ? 'fill' : undefined} />
                  {renderButtonShortcut('M')}
                </div>
              </Button>
            </TooltipTrigger>
            {renderTooltipContent(tooltipCopy.slides, 'M')}
          </Tooltip>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant={null} className={normalButtonClass} size='icon' aria-label='More actions'>
                    <EllipsisIcon className='size-4 shrink-0' />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side='bottom' sideOffset={10}>{tooltipCopy.more}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align='end' side='bottom' sideOffset={8} className='min-w-[190px]'>
              <DropdownMenuItem onSelect={() => setOpenIconSearch(true)} className='gap-2 text-sm'>
                <PuzzlePieceIcon className='size-4 shrink-0' />
                <span>Icons</span>
                <DropdownMenuShortcut>G</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOpenImageSearch(true)} className='gap-2 text-sm'>
                <ImageStackIcon className='size-4 shrink-0' />
                <span>Images</span>
                <DropdownMenuShortcut>I</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  if (isAtMaxFolderDepth) return
                  onAddNode({ nodeType: 'folder' })
                }}
                className={clsx('gap-2 text-sm', isAtMaxFolderDepth && 'opacity-50')}
              >
                <FolderPlusActionIcon className='size-4 shrink-0' />
                <span>Sub-board</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOpenDocumentUpload(true)} className='gap-2 text-sm' disabled={!boardId}>
                <DocumentFileIcon className='size-4 shrink-0' />
                <span>Document</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAddNode({ nodeType: 'code-sandbox' })} className='gap-2 text-sm'>
                <CodeFileIcon className='size-4 shrink-0' />
                <span>Code sandbox</span>
                <DropdownMenuShortcut>Y</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAddNode({ nodeType: 'widget' })} className='gap-2 text-sm'>
                <LearnWidgetIcon className='size-4 shrink-0' />
                <span>Widget</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {viewMode !== 'graph' && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={null}
                className={normalButtonClass}
                size='icon'
                onClick={() => onAddNode({ nodeType: 'sheet' })}
                aria-label='Add note'
              >
                <NotepadIcon className='size-4 shrink-0' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' sideOffset={10}>{tooltipCopy.note}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={null}
                className={clsx(normalButtonClass, isAtMaxFolderDepth && 'opacity-50')}
                size='icon'
                aria-disabled={isAtMaxFolderDepth}
                onClick={() => {
                  if (isAtMaxFolderDepth) return
                  onAddNode({ nodeType: 'folder' })
                }}
                aria-label='Add folder'
              >
                <FolderPlusActionIcon className='size-4 shrink-0' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' sideOffset={10}>{tooltipCopy.folder}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={null}
                className={normalButtonClass}
                size='icon'
                onClick={() => setOpenDocumentUpload(true)}
                aria-label='Upload document'
                disabled={!boardId}
              >
                <DocumentFileIcon className='size-4 shrink-0' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' sideOffset={10}>{tooltipCopy.document}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={null}
                className={normalButtonClass}
                size='icon'
                onClick={() => onAddNode({ nodeType: 'code-sandbox' })}
                aria-label='Add code sandbox'
              >
                <CodeFileIcon className='size-4 shrink-0' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' sideOffset={10}>Code snippet</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={null}
                className={normalButtonClass}
                size='icon'
                onClick={() => onAddNode({ nodeType: 'widget' })}
                aria-label='Add widget'
              >
                <LearnWidgetIcon className='size-4 shrink-0' />
              </Button>
            </TooltipTrigger>
            <TooltipContent side='bottom' sideOffset={10}>Widget</TooltipContent>
          </Tooltip>
        </>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={null}
            className={clsx(chatOpen ? activeButtonClass : normalButtonClass, 'md:hidden')}
            size='icon'
            onClick={() => setOpenChatDialog(!chatOpen)}
            aria-label='Open assistant'
            disabled={!boardId}
          >
            <div className='relative'>
              <ChatHistoryIcon className='size-4 shrink-0 text-sidebar-icon-4' weight={chatOpen ? 'fill' : undefined} />
              {renderButtonShortcut('C')}
            </div>
          </Button>
        </TooltipTrigger>
        {renderTooltipContent(tooltipCopy.assistant, 'C')}
      </Tooltip>

      <Separator orientation="vertical" className='md:!h-6 hidden md:block' />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={null}
            className={isPublicShared ? activeButtonClass : normalButtonClass}
            size='icon'
            onClick={() => setOpenShareDialog(true)}
            aria-label='Share board'
            disabled={!boardId}
          >
            <ShareIcon className='size-4 shrink-0' weight={isPublicShared ? 'fill' : undefined} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side='bottom' sideOffset={10}>{tooltipCopy.share}</TooltipContent>
      </Tooltip>

      <Dialog open={openShareDialog} onOpenChange={setOpenShareDialog}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Share board</DialogTitle>
            <DialogDescription>
              Public sharing lets anyone with the link view this board.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <Button
              variant={isPublicShared ? 'outline' : 'default'}
              className='w-full'
              onClick={handleTogglePublicShare}
              disabled={!boardId || isUpdatingSharing}
            >
              {isUpdatingSharing
                ? 'Updating...'
                : isPublicShared
                  ? 'Disable public sharing'
                  : 'Enable public sharing'}
            </Button>
            {isPublicShared ? (
              <Button
                variant='outline'
                className='w-full'
                onClick={handleCopyShareLink}
              >
                Copy public link
              </Button>
            ) : null}
            {shareError ? (
              <p className='text-xs text-destructive'>{shareError}</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
})
