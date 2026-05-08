import {
  ReactFlow,
  MarkerType,
  Background,
  BackgroundVariant,
  SelectionMode,
  type ReactFlowInstance,
  type ReactFlowProps,
} from '@xyflow/react'
import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'

import { NodeView } from './node-view'
import { PointNode } from './point-node'
import { DocumentNode } from './document-node'
import { EdgeView } from './edge/edge-view'
import { EdgeMarkerDefs } from './edge/edge-markers'
import { GraphContextMenu } from './graph-context-menu'
import { MotionProvider, ZoomProvider } from './motion-state-context'
import { useGraphStore } from '../../store/graph-store'
import { useEdgeLabelEdit } from '../../hooks/use-edge-label-edit'
import { useNodeViewportCull } from '../../hooks/use-node-viewport-cull'
import type { LinkEdge, NoteNode } from '../../types/flow'
import { StackedCardsIllustration } from '@/components/illustrations/stacked-cards-illustration'
import type { BoardBackgroundTexture } from '../../utils/board-background'


const proOptions = { hideAttribution: true }

const nodeTypes = { default: NodeView, point: PointNode, document: DocumentNode }
const edgeTypes = { default: EdgeView }

const defaultEdgeOptions = {
  type: 'default',
  zIndex: 1000,
  style: {
    stroke: 'var(--secondary-foreground)',
    strokeWidth: 2,
    strokeDasharray: '8 6',
    strokeLinecap: 'round' as const,
  },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: 'var(--secondary-foreground)',
    width: 22,
    height: 22,
  },
}


type EmptyGraphHintProps = {
  isMobile: boolean
}


/**
 * Centered empty-state illustration with onboarding hint.
 */
const EmptyGraphHint = memo(function EmptyGraphHint({ isMobile }: EmptyGraphHintProps) {
  const assistantLocationLabel = isMobile ? "right bar" : "top bar"

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-[760px] flex-col items-center rounded-xl bg-sidebar px-8 py-10 text-center">
        <StackedCardsIllustration
          className="h-auto w-full max-w-[520px]"
          shadowColor="color-mix(in oklab, var(--accent-foreground) 10%, transparent)"
          cardColor="var(--accent)"
          strokeColor="color-mix(in oklab, var(--accent-foreground) 40%, transparent)"
          aria-hidden="true"
        />
        <p className="mt-4 max-w-[32rem] text-balance text-lg leading-relaxed text-sidebar-foreground/50">
          Start adding components and open assistant from{" "}
          <span className="font-semibold text-sidebar-foreground">{assistantLocationLabel}</span>
        </p>
      </div>
    </div>
  )
})


export type GraphCanvasProps = {
  isLocked: boolean
  isMobile: boolean
  presentationMode: boolean
  onInit: (instance: ReactFlowInstance<NoteNode, LinkEdge>) => void
  onNodeDoubleClick: ReactFlowProps<NoteNode, LinkEdge>['onNodeDoubleClick']
  onSelectionStart: () => void
  onSelectionEnd: () => void
  onSelectionDragStart: () => void
  onSelectionDragStop: () => void
  isGraphView: boolean
  /**
   * Optional content rendered inside the ReactFlow children slot
   * (e.g. floating viewport controls). Stays inside the graph viewport.
   */
  children?: React.ReactNode
}


/**
 * Owns the React Flow surface and its directly-driven subscriptions
 * (nodes, edges, change handlers, edge label state, background variant).
 * Re-renders only when one of those changes; motion flags and chrome
 * state live in the parent and floating chrome respectively.
 */
export const GraphCanvas = memo(function GraphCanvas({
  isLocked,
  isMobile,
  presentationMode,
  onInit,
  onNodeDoubleClick,
  onSelectionStart,
  onSelectionEnd,
  onSelectionDragStart,
  onSelectionDragStop,
  isGraphView,
  children,
}: GraphCanvasProps) {
  const nodes = useGraphStore(useShallow(state => state.nodes))
  const edges = useGraphStore(useShallow(state => state.edges))

  const onNodesChange = useGraphStore(state => state.onNodesChange)
  const onEdgesChange = useGraphStore(state => state.onEdgesChange)
  const onNodesDelete = useGraphStore(state => state.onNodesDelete)
  const onEdgesDelete = useGraphStore(state => state.onEdgesDelete)
  const setNodesPersist = useGraphStore(state => state.setNodesPersist)
  const enableSelection = useGraphStore(state => state.isSelectMode)
  const boardBackgroundTexture = useGraphStore(state => state.boardBackgroundTexture)

  const backgroundVariant = useMemo(() => {
    if (!boardBackgroundTexture) return null
    const variants: Record<BoardBackgroundTexture, BackgroundVariant> = {
      dots: BackgroundVariant.Dots,
      lines: BackgroundVariant.Lines,
    }
    return variants[boardBackgroundTexture]
  }, [boardBackgroundTexture])

  const backgroundColor = useMemo(() => {
    if (!boardBackgroundTexture) return undefined
    return boardBackgroundTexture === 'lines'
      ? 'var(--muted)'
      : 'var(--muted-foreground)'
  }, [boardBackgroundTexture])

  useNodeViewportCull()

  const { edgesForRender, handleEdgeDoubleClick } = useEdgeLabelEdit({
    edges,
    isGraphView,
  })

  const handleDragStart = useCallback(() => {
    useGraphStore.getState().setIsDragging(true)
  }, [])
  const handleDragStop = useCallback(() => {
    useGraphStore.getState().setIsDragging(false)
  }, [])

  const isEmptyGraph = nodes.length === 0 && edges.length === 0

  return (
    <GraphContextMenu nodes={nodes} setNodesPersist={setNodesPersist}>
      {({ onPaneContextMenu, onNodeContextMenu }) => (
        <MotionProvider>
          <ZoomProvider>
          {isEmptyGraph && !presentationMode && (
            <EmptyGraphHint isMobile={isMobile} />
          )}

          <ReactFlow
            nodes={nodes}
            edges={edgesForRender}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            proOptions={proOptions}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            selectionOnDrag={enableSelection}
            selectionMode={SelectionMode.Full}
            panOnDrag={!isLocked && !enableSelection}
            selectionKeyCode={null}
            onNodeDragStart={handleDragStart}
            onNodeDragStop={handleDragStop}
            onSelectionStart={onSelectionStart}
            onSelectionEnd={onSelectionEnd}
            onSelectionDragStart={onSelectionDragStart}
            onSelectionDragStop={onSelectionDragStop}
            onPaneContextMenu={onPaneContextMenu}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeDoubleClick={handleEdgeDoubleClick}
            onNodeDoubleClick={onNodeDoubleClick}
            nodesDraggable={!isLocked}
            nodesConnectable={false}
            elementsSelectable={!isLocked}
            zoomOnScroll={!isLocked}
            zoomOnPinch={!isLocked}
            zoomOnDoubleClick={false}
            panOnScroll={!isLocked}
            minZoom={0.32}
            onInit={onInit}
            elevateNodesOnSelect={false}
            elevateEdgesOnSelect={true}
          >
            {backgroundVariant && (
              <Background
                variant={backgroundVariant}
                gap={25}
                size={1}
                color={backgroundColor}
              />
            )}
            <EdgeMarkerDefs edges={edges} />
            {children}
          </ReactFlow>
          </ZoomProvider>
        </MotionProvider>
      )}
    </GraphContextMenu>
  )
})
