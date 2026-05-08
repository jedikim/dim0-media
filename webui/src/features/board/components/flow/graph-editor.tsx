import {
  useReactFlow,
  useOnViewportChange,
  type ReactFlowInstance,
  type ReactFlowProps,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useShallow } from 'zustand/shallow'

import { ActionPanel } from './action-panel'
import { DefaultBoardView } from '../default-view'
import { NodePlacementOverlay } from './node-placement-overlay'
import { LinePlacementOverlay } from './line-placement-overlay'
import { NodeSurfaceHost } from './node-surface-host'
import { GraphCanvas } from './graph-canvas'
import { GraphFloatingChrome } from './graph-floating-chrome'

import { useGraphStore } from '../../store/graph-store'
import { setLastCursorPosition } from '../../store/cursor-ref'
import type { LinkEdge, NoteNode } from '../../types/flow'
import type { NodeType } from '../../types/style'

import { useAddNoteNode, type AddNoteNodeOptions } from '../../hooks/use-add-node'
import { usePlaceLine } from '../../hooks/use-place-line'
import { useMindMapStore } from '@/features/agent/store/mindmap-store'
import { useAddMindMapToBoard } from '../../api/add-mindmap-to-board'
import { useCopyPasteNodes } from '../../hooks/use-copy-paste'
import { useCenterAroundParam } from '../../hooks/use-center-around'
import { useBoardShortcuts } from '../../hooks/use-board-shortcuts'
import { useDropImageUpload } from '../../hooks/use-drop-image-upload'
import { PresentationControls } from './presentation-controls'
import { useTheme } from '@/components/theme-provider'
import { useIsMobile } from '@/hooks/use-mobile'
import { darkModeDisplayHex } from '../../lib/colors/dark-variants'
import { applyBackgroundAlpha } from '../../utils/board-background'

import './graph-styles.css'
import { useThumbnailCapture } from '../../hooks/use-thumbnail-capture'
import { ListView } from './list-view'

const drawableNodeTypes: NodeType[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'soft-diamond',
  'layered-diamond',
  'layered-circle',
  'tag',
  'layered-rectangle',
  'thought-cloud',
  'capsule',
  'slide',
]

const isDrawableNodeType = (nodeType: NodeType) => drawableNodeTypes.includes(nodeType)

type ViewMode = 'graph' | 'linear' | 'list'


/**
 * Files view (card-based board list)
 */
function LinearView() {
  return <DefaultBoardView />
}

/**
 * Main editor: always shows ActionPanel and switches between GraphView / LinearView
 */
export default function GraphEditor() {
  const [viewMode, setViewMode] = useState<ViewMode>('graph')
  const isMobile = useIsMobile()

  const enableSelection = useGraphStore(state => state.isSelectMode)
  const [shouldRecenter, setShouldRecenter] = useState<boolean>(false)
  const [isLocked, setIsLocked] = useState<boolean>(false)
  const [isSelecting, setIsSelecting] = useState<boolean>(false)
  const [pendingPlacement, setPendingPlacement] = useState<AddNoteNodeOptions | null>(null)
  const {
    pending: pendingLinePlacement,
    begin: beginLinePlacement,
    cancel: cancelLinePlacement,
    place: handlePlaceLine,
  } = usePlaceLine()

  const {
    zoomIn,
    zoomOut,
    fitView,
    viewportInitialized,
    zoomTo,
    screenToFlowPosition,
    setCenter,
  } = useReactFlow<NoteNode, LinkEdge>()

  const boardId = useGraphStore(state => state.boardId)
  const boardCanEdit = useGraphStore(state => state.boardCanEdit)
  const rootId = useGraphStore(state => state.rootId)
  const scopeViewportKey = boardId ? `${boardId}:${rootId ?? 'root'}` : undefined
  const navigate = useNavigate()

  // Parent-only reactive subs. Heavy data lives in <GraphCanvas>; motion
  // flags + chrome state live in <GraphFloatingChrome>.
  const slides = useGraphStore(useShallow(state =>
    (state.nodes as NoteNode[])
      .filter(n => n.data?.style?.type === 'slide')
      .sort((a, b) =>
        (a.data.properties.slideNumber?.number ?? 0)
          - (b.data.properties.slideNumber?.number ?? 0),
      ),
  ))
  const graphViewports = useGraphStore(useShallow(state => state.graphViewports))
  const presentationMode = useGraphStore(state => state.presentationMode)
  const activeSlideId = useGraphStore(state => state.activeSlideId)
  const boardBackground = useGraphStore(state => state.boardBackground)
  const effectiveIsLocked = isLocked || !boardCanEdit

  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const displayBoardBackground = applyBackgroundAlpha(
    isDark ? darkModeDisplayHex(boardBackground) || boardBackground : boardBackground,
    0.5
  ) || undefined

  useEffect(() => {
    const renderer = document.querySelector('.react-flow__renderer') as HTMLElement | null
    if (!renderer) return

    const setSize = useGraphStore.getState().setRendererSize
    const updateSize = () => {
      const rect = renderer.getBoundingClientRect()
      setSize({ width: rect.width, height: rect.height })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(renderer)

    return () => {
      observer.disconnect()
      setSize(null)
    }
  }, [])

  const mindmaps = useMindMapStore(state => state.mindmaps)
  const { addMindMapToBoardAsync } = useAddMindMapToBoard()

  useCopyPasteNodes({
    jitterMax: 40,
    shortcuts: true,
  })

  useCenterAroundParam({ setCenter })

  useBoardShortcuts({
    enabled: viewMode === 'graph',
    shortcuts: [
      { key: 'z', withMod: true, withShift: false, handler: () => useGraphStore.getState().undo() },
      { key: 'z', withMod: true, withShift: true, handler: () => useGraphStore.getState().redo() },
      { key: 'y', withMod: true, handler: () => useGraphStore.getState().redo() },
    ],
  })

  const addNoteNode = useAddNoteNode()

  const beginPlacement = useCallback((options: AddNoteNodeOptions) => {
    if (!options.nodeType) return
    setPendingPlacement({
      ...options,
      position: undefined,
      size: undefined,
    })
  }, [])

  const cancelPlacement = useCallback(() => {
    setPendingPlacement(null)
  }, [])

  const handlePlacementComplete = useCallback(
    (options: AddNoteNodeOptions) => {
      addNoteNode(options)
      setPendingPlacement(null)
    },
    [addNoteNode],
  )

  useEffect(() => {
    if (viewMode !== 'graph' && pendingPlacement) {
      cancelPlacement()
    }
    if (viewMode !== 'graph' && pendingLinePlacement) {
      cancelLinePlacement()
    }
  }, [viewMode, pendingPlacement, pendingLinePlacement, cancelPlacement, cancelLinePlacement])

  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (viewMode !== 'graph') return
      // if user can't edit, dont allow adding nodes via double click
      if (!boardCanEdit) return
      if (!screenToFlowPosition) return
      if ((event.target as HTMLElement | null)?.closest('.react-flow__node')) return
      if ((event.target as HTMLElement | null)?.closest('.react-flow__edge')) return
      const flowPoint = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      addNoteNode({ nodeType: 'text', position: flowPoint })
    },
    [viewMode, boardCanEdit, screenToFlowPosition, addNoteNode],
  )

  const handlePaneMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (viewMode !== 'graph') return
      if (!screenToFlowPosition) return
      const flowPoint = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setLastCursorPosition(flowPoint)
    },
    [viewMode, screenToFlowPosition],
  )

  const { onDragOver: handleImageDragOver, onDrop: handleImageDrop } = useDropImageUpload({
    enabled: viewMode === 'graph' && boardCanEdit && !effectiveIsLocked,
    screenToFlowPosition,
  })

  const handleNodeDoubleClick = useCallback<NonNullable<ReactFlowProps<NoteNode, LinkEdge>['onNodeDoubleClick']>>(
    (event, node) => {
      if (!boardId) return
      const nodeType = node.data?.style?.type
      if (nodeType !== 'folder') return
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-folder-label-edit="true"]')) return
      navigate({
        to: "/boards/$id",
        params: { id: boardId },
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          root_id: node.id,
        }),
      })
    },
    [boardId, navigate],
  )

  const handlePanelAddNode = useCallback(
    (options: AddNoteNodeOptions) => {
      const nodeType = options.nodeType ?? 'rectangle'
      if (isDrawableNodeType(nodeType) && !options.imageUrl && !options.icon) {
        beginPlacement({ ...options, nodeType })
        return
      }
      addNoteNode(options)
    },
    [addNoteNode, beginPlacement],
  )

  const handleAddLine = useCallback(() => {
    beginLinePlacement()
  }, [beginLinePlacement])

  const rfInstanceRef = useRef<ReactFlowInstance<NoteNode, LinkEdge> | null>(null)
  const slideIds = useMemo(() => slides.map(s => s.id), [slides])

  // Mindmap integration
  useEffect(() => {
    const integrateMindmap = async () => {
      if (boardId && mindmaps.has(boardId)) {
        await addMindMapToBoardAsync()
      }
    }
    integrateMindmap()
  }, [boardId, mindmaps, addMindMapToBoardAsync])

  // Recenter when toggling view
  useEffect(() => {
    if (!shouldRecenter || viewMode !== 'graph') return
    fitView({ padding: 0.2, minZoom: 1, maxZoom: 1 })
    setShouldRecenter(false)
  }, [shouldRecenter, fitView, viewMode])

  // Initial viewport / restore saved viewport
  useEffect(() => {
    if (!viewportInitialized) return
    if (!scopeViewportKey || !graphViewports[scopeViewportKey]) {
      fitView({ padding: 0.2, maxZoom: 1 })
    }
  }, [viewportInitialized, fitView, scopeViewportKey, graphViewports])

  const handleZoomIn = useCallback(() => zoomIn({ duration: 200 }), [zoomIn])
  const handleZoomOut = useCallback(() => zoomOut({ duration: 200 }), [zoomOut])
  const handleResetZoom = useCallback(() => {
    zoomTo(1)
  }, [zoomTo])

  const handleToggleLock = useCallback(() => {
    if (!boardCanEdit) return
    setIsLocked(value => !value)
  }, [boardCanEdit, setIsLocked])

  useEffect(() => {
    if (!boardCanEdit) {
      setIsLocked(true)
    }
  }, [boardCanEdit])

  const handleSelectionStart = useCallback(() => setIsSelecting(true), [])
  const handleSelectionDragStart = useCallback(() => setIsSelecting(true), [])
  const handleSelectionEnd = useCallback(() => setIsSelecting(false), [])
  const handleSelectionDragStop = useCallback(() => setIsSelecting(false), [])

  const activeSlideIndex = activeSlideId ? slideIds.indexOf(activeSlideId) : -1
  const canPrev = activeSlideIndex > 0
  const canNext = activeSlideIndex >= 0 && activeSlideIndex < slideIds.length - 1

  const goToSlide = useCallback(async (index: number) => {
    const node = slides[index]
    if (!node) return
    useGraphStore.getState().setActiveSlideId(node.id)
    await fitView({ nodes: [node], padding: 0.2, duration: 250 })
  }, [fitView, slides])

  const restoreViewport = useCallback(() => {
    if (!scopeViewportKey) return
    const saved = graphViewports[scopeViewportKey]
    if (saved && rfInstanceRef.current?.setViewport) {
      rfInstanceRef.current.setViewport(saved, { duration: 200 })
    }
  }, [scopeViewportKey, graphViewports])

  useBoardShortcuts({
    enabled: presentationMode,
    shortcuts: [
      { key: 'arrowleft', handler: () => canPrev && goToSlide(activeSlideIndex - 1) },
      { key: 'arrowright', handler: () => canNext && goToSlide(activeSlideIndex + 1) },
      { key: 'escape', handler: () => {
        const store = useGraphStore.getState()
        store.setPresentationMode(false)
        store.setActiveSlideId(undefined)
        store.setIsSelectMode(false)
        restoreViewport()
      } },
    ],
  })

  useOnViewportChange({
    onStart: () => {
      useGraphStore.getState().setIsMoving(true)
    },
    onEnd: vp => {
      const store = useGraphStore.getState()
      if (scopeViewportKey && !presentationMode) {
        store.setGraphViewport(scopeViewportKey, vp)
      }
      store.setZoom(vp.zoom)
      store.setIsMoving(false)
    },
  })

  const captureThumbnail = useThumbnailCapture(boardId || '')

  const handleInit = (instance: ReactFlowInstance<NoteNode, LinkEdge>) => {
    rfInstanceRef.current = instance
    if (scopeViewportKey) {
      const saved = graphViewports[scopeViewportKey]
      if (saved) {
        // restore immediately, no animation
        instance.setViewport(saved, { duration: 0 })
      }
    }
    captureThumbnail(instance)
  }

  return (
    <div className="w-full h-full relative">
      {boardCanEdit ? (
        <ActionPanel
          onAddNode={handlePanelAddNode}
          onAddLine={handleAddLine}
          enableSelection={enableSelection}
          setEnableSelection={useGraphStore.getState().setIsSelectMode}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
          toggleLock={handleToggleLock}
          viewMode={viewMode}
          setViewMode={setViewMode}
        />
      ) : null}

      <div
        className="relative w-full h-full"
        style={{ backgroundColor: displayBoardBackground }}
        onDoubleClick={handlePaneDoubleClick}
        onMouseMove={handlePaneMouseMove}
        onDragOver={handleImageDragOver}
        onDrop={handleImageDrop}
      >
        <div className="board-paper-grain" aria-hidden="true" />
        {viewMode === 'graph' ? (
          <>
            <GraphCanvas
              isLocked={effectiveIsLocked}
              isMobile={isMobile}
              presentationMode={presentationMode}
              onInit={handleInit}
              onNodeDoubleClick={handleNodeDoubleClick}
              onSelectionStart={handleSelectionStart}
              onSelectionEnd={handleSelectionEnd}
              onSelectionDragStart={handleSelectionDragStart}
              onSelectionDragStop={handleSelectionDragStop}
              isGraphView={viewMode === 'graph'}
            />

            <GraphFloatingChrome
              presentationMode={presentationMode}
              isSelecting={isSelecting}
              effectiveIsLocked={effectiveIsLocked}
              boardCanEdit={boardCanEdit}
              toggleLock={handleToggleLock}
            />

            <NodePlacementOverlay
              pendingPlacement={pendingPlacement}
              onPlace={handlePlacementComplete}
              onCancel={cancelPlacement}
              screenToFlowPosition={screenToFlowPosition}
            />
            <LinePlacementOverlay
              pending={pendingLinePlacement}
              onPlace={handlePlaceLine}
              onCancel={cancelLinePlacement}
              screenToFlowPosition={screenToFlowPosition}
            />
          </>
        ) : viewMode === 'linear' ? (
          <LinearView />
        ) : (
          <ListView />
        )}
      </div>

      {presentationMode && (
        <PresentationControls
          onPrev={() => canPrev && goToSlide(activeSlideIndex - 1)}
          onNext={() => canNext && goToSlide(activeSlideIndex + 1)}
          onStop={() => {
            const store = useGraphStore.getState()
            store.setPresentationMode(false)
            store.setActiveSlideId(undefined)
            store.setIsSelectMode(false)
            restoreViewport()
          }}
          disablePrev={!canPrev}
          disableNext={!canNext}
        />
      )}

      <NodeSurfaceHost />
    </div>
  )
}
