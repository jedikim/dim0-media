import { memo, useEffect, useState } from 'react'
import type { AddNoteNodeOptions } from '../../hooks/use-add-node'
import { ImageSearchDialog } from './utils/image-search'
import { IconSearchDialog } from './utils/icon-search'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useGraphStore } from '../../store/graph-store'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useBoardShortcuts } from '../../hooks/use-board-shortcuts'
import { DocumentUploadDialog } from './utils/document-upload'
import { TopBar } from './top-bar'
import { SlidePanel } from './slide-panel'
import { CopilotSheet } from './copilot-sheet'
import { FloatingAssistant } from './floating-assistant/floating-assistant'
import { updateBoard } from '../../api/update-board'


type ViewMode = 'graph' | 'linear' | 'list'

interface ActionPanelProps {
  onAddNode: (options: AddNoteNodeOptions) => void
  onAddLine: () => void
  enableSelection: boolean
  setEnableSelection: (mode: boolean) => void

  // React Flow controls
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  toggleLock: () => void

  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

/**
 * Action panel orchestrator for tools + navigation controls.
 */
export const ActionPanel = memo(function ActionPanel({
  onAddNode,
  onAddLine,
  enableSelection,
  setEnableSelection,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  toggleLock,
  viewMode,
  setViewMode
}: ActionPanelProps) {
  const [openImageSearch, setOpenImageSearch] = useState(false)
  const [openIconSearch, setOpenIconSearch] = useState(false)
  // Lifted to graph-store so the surface panels (sheet/code/widget) can
  // open the chat sideview from their mobile-only sparkles button. Also
  // resets automatically on scope change in `setGraphScope`.
  const openChatDialog = useGraphStore(state => state.chatSheetOpen)
  const setOpenChatDialog = useGraphStore(state => state.setChatSheetOpen)
  const [openShapeMenu, setOpenShapeMenu] = useState(false)
  const [openDocumentUpload, setOpenDocumentUpload] = useState(false)
  const [openSlidesPanel, setOpenSlidesPanel] = useState(false)
  const boardId = useGraphStore(state => state.boardId)
  const boardVisibility = useGraphStore(state => state.boardVisibility)
  const setNodes = useGraphStore(state => state.setNodes)
  const setBoardVisibility = useGraphStore(state => state.setBoardVisibility)
  const setViewSlides = useGraphStore(state => state.setViewSlides)
  const presentationMode = useGraphStore(state => state.presentationMode)
  const navigate = useNavigate()
  // `strict: false` so this also reads the search on the surface routes
  // (/boards/$id/sheets/$noteId, /code-sandbox/$noteId, /widgets/$noteId);
  // a `from: "/boards/$id"` would only match the bare board route and
  // silently drop `current_chat_id` on those nested routes.
  const boardSearch = useSearch({
    strict: false,
    select: (s: { current_chat_id?: string }) => ({ currentChatId: s.current_chat_id }),
  })
  const currentChatId = boardSearch?.currentChatId

  useEffect(() => {
    setViewSlides(openSlidesPanel)
  }, [openSlidesPanel, setViewSlides])

  useEffect(() => {
    setNodes(ns =>
      ns.map(n => {
        if (n.data?.style?.type !== 'slide') return n
        return {
          ...n,
          style: { ...(n.style ?? {}), pointerEvents: openSlidesPanel ? 'auto' : 'none' },
          dragHandle: '.slide-handle',
        }
      })
    )
  }, [openSlidesPanel, setNodes])

  useBoardShortcuts({
    enabled: viewMode === 'graph',
    shortcuts: [
      { key: 'a', handler: onAddLine },
      { key: 'n', handler: () => onAddNode({ nodeType: 'sheet' }) },
      { key: 's', handler: () => setOpenShapeMenu(true) },
      { key: 'r', handler: () => onAddNode({ nodeType: 'rectangle' }) },
      { key: 'o', handler: () => onAddNode({ nodeType: 'ellipse' }) },
      { key: 'd', handler: () => onAddNode({ nodeType: 'diamond' }) },
      { key: 't', handler: () => onAddNode({ nodeType: 'text' }) },
      { key: 'y', handler: () => onAddNode({ nodeType: 'code-sandbox' }) },
      { key: 'g', handler: () => setOpenIconSearch(true) },
      { key: 'i', handler: () => setOpenImageSearch(true) },
      { key: 'c', handler: () => boardId && setOpenChatDialog(true) },
      { key: 'm', handler: () => boardId && setOpenSlidesPanel(true) },
      { key: 'p', handler: () => setEnableSelection(false) },
      { key: 'v', handler: () => setEnableSelection(!enableSelection) },
      { key: 'l', handler: toggleLock },
      { key: '=', handler: onZoomIn },
      { key: '+', handler: onZoomIn },
      { key: '-', handler: onZoomOut },
      { key: '_', handler: onZoomOut },
      { key: '0', handler: onResetZoom },
    ],
  })

  const handleUpdateVisibility = async (visibility: 'private' | 'public') => {
    if (!boardId) return
    await updateBoard(boardId, { visibility })
    setBoardVisibility(visibility)
  }

  return (
    <>
      {!presentationMode && (
        <TopBar
          onAddNode={onAddNode}
          onAddLine={onAddLine}
          viewMode={viewMode}
          setViewMode={setViewMode}
          enableSelection={enableSelection}
          setEnableSelection={setEnableSelection}
          openShapeMenu={openShapeMenu}
          setOpenShapeMenu={setOpenShapeMenu}
          setOpenIconSearch={setOpenIconSearch}
          setOpenImageSearch={setOpenImageSearch}
          setOpenDocumentUpload={setOpenDocumentUpload}
          setOpenChatDialog={setOpenChatDialog}
          chatOpen={openChatDialog}
          onToggleSlidesPanel={() => setOpenSlidesPanel(v => !v)}
          slidesPanelOpen={openSlidesPanel}
          boardId={boardId}
          boardVisibility={boardVisibility}
          onUpdateVisibility={handleUpdateVisibility}
        />
      )}

      <ImageSearchDialog openImageSearch={openImageSearch} setOpenImageSearch={setOpenImageSearch} />
      <IconSearchDialog openIconSearch={openIconSearch} setOpenIconSearch={setOpenIconSearch} />
      <DocumentUploadDialog open={openDocumentUpload} onOpenChange={setOpenDocumentUpload} />
      <Sheet open={openSlidesPanel} onOpenChange={setOpenSlidesPanel} modal={false} disablePointerDismissal>
        <SheetContent
          side="right"
          showOverlay={false}
          showClose={false}
          className="w-[360px] max-w-[92vw] bg-sidebar text-sidebar-foreground border-l border-border p-0"
        >
          <SheetHeader className='sr-only'>
            <SheetTitle>Slides</SheetTitle>
          </SheetHeader>
          <SlidePanel onClose={() => setOpenSlidesPanel(false)} />
        </SheetContent>
      </Sheet>
      {!openChatDialog && !presentationMode && viewMode === 'graph' && boardId && (
        <FloatingAssistant
          boardId={boardId}
          currentChatId={currentChatId}
          onOpenFullSheet={() => setOpenChatDialog(true)}
        />
      )}
      <CopilotSheet
        open={openChatDialog}
        onOpenChange={setOpenChatDialog}
        boardId={boardId}
        currentChatId={currentChatId}
        onOpenFullChat={(chatId) => {
          setOpenChatDialog(false)
          if (chatId) {
            navigate({
              to: "/chats/$id",
              params: { id: chatId },
              search: (prev: Record<string, unknown>) => ({
                ...prev,
                board_id: boardId || undefined,
              }),
            })
          } else {
            navigate({
              to: "/chats",
              search: (prev: Record<string, unknown>) => ({
                ...prev,
                board_id: boardId || undefined,
              }),
            })
          }
        }}
      />
    </>
  )
})
