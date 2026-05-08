import { memo } from 'react'
import {
  type ControlPosition,
  type NodeProps,
  NodeResizeControl,
} from '@xyflow/react'
import type { NoteNode } from '../../types/flow'
import { NodeCard } from './note-card'
import { useGraphStore } from '../../store/graph-store'
import clsx from 'clsx'
import { DragGripIcon } from '@/components/icons'
import { useTheme } from '@/components/theme-provider'
import { darkModeDisplayHex } from '../../lib/colors/dark-variants'
import { useContentMinHeight } from '../../hooks/use-content-min-height'
import { ShapeChrome } from './shape-chrome'
import { FolderNode } from './folder-node'
import { SHEET_MIN_HEIGHT, SHEET_MIN_WIDTH } from '../../types/note'
import { nodeUsesContentMinHeight } from '../../utils/note-box'

const CONNECTOR_GAP = 0
type ResizeHandle = {
  pos: ControlPosition
  className: string
}

const RESIZE_HANDLES: ResizeHandle[] = [
  { pos: 'top-left', className: 'top-0 left-0 cursor-nwse-resize' },
  { pos: 'top-right', className: 'top-0 right-0 cursor-nesw-resize' },
  { pos: 'bottom-left', className: 'bottom-0 left-0 cursor-nesw-resize' },
  { pos: 'bottom-right', className: 'bottom-0 right-0 cursor-nwse-resize' },
]

const getHandleTransform = (pos: ControlPosition) => {
  const x = pos.includes('right') ? '25%' : '-25%'
  const y = pos.includes('bottom') ? '25%' : '-25%'
  return `translate(${x}, ${y})`
}

type ResizeHandlesProps = {
  selected: boolean
  minHeight: number
  minWidth: number
  keepAspectRatio?: boolean
  onResizeStart: () => void
  onResizeEnd: () => void
}

const ResizeHandles = memo(function ResizeHandles({
  selected,
  minHeight,
  minWidth,
  keepAspectRatio = false,
  onResizeStart,
  onResizeEnd,
}: ResizeHandlesProps) {
  if (!selected) return null

  return RESIZE_HANDLES.map(({ pos, className }) => (
    <NodeResizeControl
      key={pos}
      position={pos}
      onResizeStart={onResizeStart}
      onResizeEnd={onResizeEnd}
      minHeight={minHeight}
      minWidth={minWidth}
      keepAspectRatio={keepAspectRatio}
    >
      <div
        className={`absolute w-3 h-3 bg-secondary-foreground rounded-sm ${className} z-20`}
        style={{ transform: getHandleTransform(pos) }}
      />
    </NodeResizeControl>
  ))
})

type NodeStatusOverlayProps = {
  selected: boolean
  nodeType: NoteNode['data']['style']['type']
}

const NodeStatusOverlay = memo(function NodeStatusOverlay({
  selected,
  nodeType,
}: NodeStatusOverlayProps) {
  if (selected && nodeType !== 'sheet') {
    return <div className='absolute inset-0 border border-secondary-foreground pointer-events-none rounded-none z-10' />
  }
  return null
})

type SlideFrameProps = {
  slideName: string
}

const SlideFrame = memo(function SlideFrame({ slideName }: SlideFrameProps) {
  return (
    <div className='w-full h-full relative'>
      <div className='absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs font-medium text-muted-foreground slide-handle cursor-grab active:cursor-grabbing'>
        <span className='inline-flex items-center justify-center w-6 h-6 rounded-md border border-border bg-card shadow-sm'>
          <DragGripIcon className='size-3' />
        </span>
        {slideName}
      </div>
      <div className='w-full h-full rounded-lg border-2 border-dashed border-secondary-foreground/60 bg-transparent' />
    </div>
  )
})

/**
 * Node view component for rendering a note node in the graph.
 */
function NodeViewBase({ id, data, selected, width, height, dragging }: NodeProps<NoteNode>) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const viewSlides = useGraphStore(state => state.viewSlides)

  const nodeType = data.style.type
  const isVisualNode = nodeType === 'image' || nodeType === 'icon' || nodeType === 'slide'
  const usesContentMinHeight = nodeUsesContentMinHeight(nodeType)

  const persistedHeight = data.properties.nodeSize?.size?.height
  const persistedWidth = data.properties.nodeSize?.size?.width
  const liveHeight = typeof height === 'number' && Number.isFinite(height) ? height : undefined
  const liveWidth = typeof width === 'number' && Number.isFinite(width) ? width : undefined
  const currentNodeHeight = liveHeight ?? persistedHeight
  const currentNodeWidth = liveWidth ?? persistedWidth

  const noteText = data.content?.markdown ?? data.label?.markdown ?? ''
  const { computedMinH } = useContentMinHeight(id, {
    text: noteText,
    nodeWidth: currentNodeWidth,
    nodeType,
    fontFamily: data.style.fontFamily,
    fontSize: data.style.fontSize,
    textStyle: data.style.textStyle,
    enabled: usesContentMinHeight,
    fallbackHeight: currentNodeHeight,
  })

  const baseMinH = isVisualNode
    ? 50
    : usesContentMinHeight
      ? computedMinH
      : 20
  const innerMinH = Math.max(20, baseMinH)

  const isPinned = data.properties.pinned.boolean

  const nodeClass = clsx(
    'w-full h-full relative font-handwriting pointer-events-auto bg-transparent',
    nodeType !== 'widget' && 'drag-handle',
  )
  const rounded = data.style.roundness > 0 ? 'rounded-2xl' : 'none'
  const frameClass = clsx('rounded-xl', isPinned && 'ring-2 ring-secondary-foreground')

  const backgroundColor = isDark ? darkModeDisplayHex(data.style.backgroundColor) || undefined : data.style.backgroundColor
  const strokeColor = isDark ? darkModeDisplayHex(data.style.strokeColor) || undefined : data.style.strokeColor
  const textColor = isDark ? darkModeDisplayHex(data.style.textColor) || undefined : data.style.textColor

  const handleResizeStart = () => {
    useGraphStore.getState().setIsResizingNode(true)
  }
  const handleResizeEnd = () => {
    useGraphStore.getState().setIsResizingNode(false)
  }
  const resizeMinWidth = isVisualNode ? 80 : 20
  const resizeMinHeight = isVisualNode ? 80 : innerMinH

  if (nodeType === 'slide') {
    if (!viewSlides) return null
    const slideName = (data.properties as { slideName?: { text?: string } } | undefined)?.slideName?.text || 'Slide'

    return (
      <div className='border-none relative bg-transparent overflow-visible w-full h-full p-0'>
        <SlideFrame slideName={slideName} />
        <ResizeHandles
          selected={selected}
          minHeight={innerMinH}
          minWidth={resizeMinWidth}
          keepAspectRatio
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
        />
      </div>
    )
  }

  const content = (
    <div className={nodeClass}>
      <NodeCard
        note={data}
        selected={selected}
        dragging={dragging}
        isDark={isDark}
        nodeWidth={width}
        nodeHeight={height}
      />
      <NodeStatusOverlay selected={selected} nodeType={nodeType} />
    </div>
  )

  if (nodeType === 'sheet') {
    return (
      <div className='group border-none relative bg-transparent overflow-visible w-full h-full p-0'>
        <div
          className='absolute inset-0'
          style={{
            top: CONNECTOR_GAP,
            right: CONNECTOR_GAP,
            bottom: CONNECTOR_GAP,
            left: CONNECTOR_GAP,
          }}
        >
          <ShapeChrome
            type={nodeType}
            minHeight={innerMinH}
            widthPx={currentNodeWidth}
            heightPx={currentNodeHeight}
            rounded={rounded}
            frameClass={frameClass}
            textColor={textColor}
            backgroundColor={backgroundColor}
            strokeColor={strokeColor}
            roughness={data.style.roughness}
            strokeStyle={data.style.strokeStyle}
            strokeWidth={data.style.strokeWidth}
            seed={data.roughSeed}
          >
            {content}
          </ShapeChrome>
        </div>

        <div
          className={clsx(
            'absolute -top-7 left-1/2 -translate-x-1/2 z-20 inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm cursor-grab active:cursor-grabbing transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          aria-label='Drag to move note'
          title='Drag to move'
        >
          <DragGripIcon className='size-3' />
        </div>

        <ResizeHandles
          selected={selected}
          minHeight={SHEET_MIN_HEIGHT}
          minWidth={SHEET_MIN_WIDTH}
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
        />
      </div>
    )
  }

  if (nodeType === 'folder') {
    return (
      <div className='border-none relative bg-transparent overflow-visible w-full h-full p-0'>
        <div
          className='absolute inset-0'
          style={{
            top: CONNECTOR_GAP,
            right: CONNECTOR_GAP,
            bottom: CONNECTOR_GAP,
            left: CONNECTOR_GAP,
          }}
        >
          <FolderNode id={id} data={data} />
          <NodeStatusOverlay selected={selected} nodeType={nodeType} />
        </div>

        <ResizeHandles
          selected={selected}
          minHeight={resizeMinHeight}
          minWidth={resizeMinWidth}
          keepAspectRatio
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
        />
      </div>
    )
  }

  return (
    <div className='border-none relative bg-transparent overflow-visible w-full h-full p-0'>
      <div
        className='absolute inset-0'
        style={{
          top: CONNECTOR_GAP,
          right: CONNECTOR_GAP,
          bottom: CONNECTOR_GAP,
          left: CONNECTOR_GAP,
        }}
      >
        <ShapeChrome
          type={nodeType}
          minHeight={innerMinH}
          widthPx={currentNodeWidth}
          heightPx={currentNodeHeight}
          rounded={rounded}
          frameClass={frameClass}
          textColor={textColor}
          backgroundColor={backgroundColor}
          strokeColor={strokeColor}
          roughness={data.style.roughness}
          strokeStyle={data.style.strokeStyle}
          strokeWidth={data.style.strokeWidth}
          seed={data.roughSeed}
          className='w-full h-full'
        >
          {content}
        </ShapeChrome>
      </div>

      <ResizeHandles
        selected={selected}
        minHeight={resizeMinHeight}
        minWidth={resizeMinWidth}
        keepAspectRatio={isVisualNode}
        onResizeStart={handleResizeStart}
        onResizeEnd={handleResizeEnd}
      />
    </div>
  )
}

export const NodeView = memo(NodeViewBase)
