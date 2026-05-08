import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, type Viewport } from '@xyflow/react'
import { useShallow } from 'zustand/shallow'

import { GraphSidebar } from '../style-panel/panel'
import { ViewportControls } from './viewport-controls'
import { useGraphStore } from '../../store/graph-store'
import type { LinkEdge, NoteNode } from '../../types/flow'


const FLOATING_UI_REAPPEAR_DELAY = 400


/**
 * Persistent zoom hint at the top center of the graph area.
 */
function GraphZoomHint() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 z-10 flex justify-center px-4 hidden md:block">
      <p className="text-center text-xs leading-relaxed text-sidebar-foreground/60">
        Use Ctrl + mouse scroll or Ctrl + / Ctrl - to zoom in and out
      </p>
    </div>
  )
}


export type GraphFloatingChromeProps = {
  presentationMode: boolean
  isSelecting: boolean
  effectiveIsLocked: boolean
  boardCanEdit: boolean
  toggleLock: () => void
}


/**
 * Floating chrome for the graph view: style sidebar, viewport controls
 * (mini-map + zoom + lock + background), and the zoom hint. Owns the
 * deferred show/hide logic that suppresses these during motion. Subscribes
 * to motion flags and chrome-specific state directly so the parent doesn't
 * re-render on every drag/pan tick.
 */
export const GraphFloatingChrome = memo(function GraphFloatingChrome({
  presentationMode,
  isSelecting,
  effectiveIsLocked,
  boardCanEdit,
  toggleLock,
}: GraphFloatingChromeProps) {
  const { zoomTo, setCenter, getViewport } = useReactFlow<NoteNode, LinkEdge>()

  const isMoving = useGraphStore(state => state.isMoving)
  const isDragging = useGraphStore(state => state.isDragging)
  const isResizingNode = useGraphStore(state => state.isResizingNode)

  const nodes = useGraphStore(useShallow(state => state.nodes))
  const zoom = useGraphStore(state => state.zoom ?? 1)
  const undo = useGraphStore(state => state.undo)
  const redo = useGraphStore(state => state.redo)
  const canUndo = useGraphStore(state => state.historyPast.length > 0)
  const canRedo = useGraphStore(state => state.historyFuture.length > 0)
  const boardBackground = useGraphStore(state => state.boardBackground)
  const setBoardBackground = useGraphStore(state => state.setBoardBackground)
  const boardBackgroundTexture = useGraphStore(state => state.boardBackgroundTexture)
  const setBoardBackgroundTexture = useGraphStore(state => state.setBoardBackgroundTexture)

  const [showMiniMap, setShowMiniMap] = useState<boolean>(true)
  const [showStylePanel, setShowStylePanel] = useState<boolean>(true)
  const miniMapTimeoutRef = useRef<number | null>(null)
  const stylePanelTimeoutRef = useRef<number | null>(null)

  const shouldHideFloatingUi =
    presentationMode || isMoving || isDragging || isResizingNode || isSelecting

  const clearDeferredUiTimeouts = useCallback(() => {
    if (miniMapTimeoutRef.current) {
      clearTimeout(miniMapTimeoutRef.current)
      miniMapTimeoutRef.current = null
    }
    if (stylePanelTimeoutRef.current) {
      clearTimeout(stylePanelTimeoutRef.current)
      stylePanelTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (shouldHideFloatingUi) {
      clearDeferredUiTimeouts()
      setShowMiniMap(false)
      setShowStylePanel(false)
      return
    }

    miniMapTimeoutRef.current = window.setTimeout(() => {
      setShowMiniMap(true)
      miniMapTimeoutRef.current = null
    }, FLOATING_UI_REAPPEAR_DELAY)

    stylePanelTimeoutRef.current = window.setTimeout(() => {
      setShowStylePanel(true)
      stylePanelTimeoutRef.current = null
    }, FLOATING_UI_REAPPEAR_DELAY)

    return () => {
      clearDeferredUiTimeouts()
    }
  }, [shouldHideFloatingUi, clearDeferredUiTimeouts])

  const handleResetZoom = useCallback(() => {
    zoomTo(1)
  }, [zoomTo])

  const handleMiniMapNavigate = useCallback(
    ({ x, y }: { x: number; y: number }, zoomLevel: number) => {
      setCenter(x, y, { zoom: zoomLevel, duration: 150 })
    },
    [setCenter],
  )

  const getCurrentViewport = useCallback((): Viewport | null => {
    return getViewport() ?? null
  }, [getViewport])

  return (
    <>
      {showStylePanel && !shouldHideFloatingUi && boardCanEdit && (
        <div className="absolute top-16 left-1 w-auto max-w-[300px] h-auto z-50">
          <GraphSidebar />
        </div>
      )}

      {showMiniMap && !shouldHideFloatingUi && (
        <ViewportControls
          nodes={nodes}
          onResetZoom={handleResetZoom}
          zoom={zoom}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          isLocked={effectiveIsLocked}
          toggleLock={toggleLock}
          boardBackground={boardBackground}
          boardBackgroundTexture={boardBackgroundTexture}
          onBoardBackgroundChange={setBoardBackground}
          onBoardBackgroundReset={() => setBoardBackground(null)}
          onBoardBackgroundTextureChange={setBoardBackgroundTexture}
          onNavigate={handleMiniMapNavigate}
          getCurrentViewport={getCurrentViewport}
        />
      )}

      {!presentationMode && <GraphZoomHint />}
    </>
  )
})
