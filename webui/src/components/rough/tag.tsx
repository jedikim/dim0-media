import React, { memo, useCallback, useEffect, useRef } from 'react'
import { RoughCanvas } from 'roughjs/bin/canvas'
import clsx from 'clsx'
import type { StrokeStyle } from '@/features/board/types/style'
import { getCachedCanvas, serializeCacheKey } from './cache'
import { tagPath } from './paths'
import { FillLayer } from './fill-layer'
import { resolveEdgeRender } from './derived-edge'
import { useTheme } from '@/components/theme-provider'
import { useGraphStore } from '@/features/board/store/graph-store'

type RoughShapeProps = {
  children?: React.ReactNode
  roughness?: number
  stroke?: string
  strokeStyle?: StrokeStyle // 'solid' | 'dashed' | 'dotted'
  strokeWidth?: number
  fill?: string
  className?: string
  seed?: number
  widthPx?: number
  heightPx?: number
}

type DrawConfig = {
  cssW: number
  cssH: number
  zoom: number
  roughness: number
  stroke: string
  strokeStyle: StrokeStyle
  strokeWidth: number
  seed: number
  dpr: number
  renderScale: number
}

type SimplifiedTagOverlayProps = {
  edgeColor: string
  edgeWidth: number
  edgeStyle: StrokeStyle
  fillInset: number
  widthPx: number
  heightPx: number
}

const SimplifiedTagOverlay = memo(function SimplifiedTagOverlay({
  edgeColor,
  edgeWidth,
  edgeStyle,
  fillInset,
  widthPx,
  heightPx
}: SimplifiedTagOverlayProps) {
  const { strokeLineDash, lineCap } = mapStrokeStyle(edgeStyle, edgeWidth)
  const dashArray = strokeLineDash ? strokeLineDash.join(' ') : undefined
  const innerW = Math.max(1, widthPx - fillInset * 2)
  const innerH = Math.max(1, heightPx - fillInset * 2)
  const notch = Math.min(innerH * 0.45, innerW * 0.3)
  const radius = Math.min(innerH / 2, innerW / 4, 18)
  const pathData = tagPath(innerW, innerH, notch, radius)

  return (
    <svg
      className='absolute pointer-events-none'
      style={{ top: fillInset, right: fillInset, bottom: fillInset, left: fillInset, width: 'auto', height: 'auto', zIndex: 10, overflow: 'visible' }}
      viewBox={`0 0 ${innerW} ${innerH}`}
      preserveAspectRatio="none"
    >
      <path
        d={pathData}
        fill='transparent'
        stroke={edgeWidth > 0 ? edgeColor : 'transparent'}
        strokeWidth={edgeWidth}
        strokeDasharray={dashArray}
        strokeLinecap={lineCap}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
})

const drawConfigEqual = (a: DrawConfig | null, b: DrawConfig) => {
  if (!a) return false
  return (
    a.cssW === b.cssW &&
    a.cssH === b.cssH &&
    a.zoom === b.zoom &&
    a.roughness === b.roughness &&
    a.stroke === b.stroke &&
    a.strokeStyle === b.strokeStyle &&
    a.strokeWidth === b.strokeWidth &&
    a.seed === b.seed &&
    a.dpr === b.dpr &&
    a.renderScale === b.renderScale
  )
}

const quantizeZoom = (value: number): number => {
  if (!Number.isFinite(value)) return 1
  return Math.max(0.1, Math.round(value * 10) / 10)
}

const oversampleForZoom = (value: number): number => {
  if (!Number.isFinite(value)) return 1
  if (value >= 1) {
    return Math.min(1.5, 1 + (value - 1) * 0.5)
  }
  return Math.max(0.1, value)
}

const MAX_RENDER_WIDTH = 1600
const MAX_RENDER_HEIGHT = 900
const RENDER_SCALE_FACTOR = 0.75

type DetailSettings = {
  curveStepCount: number
  maxRandomnessOffset: number
  hachureGap: number
}

const detailForSize = (maxSide: number): DetailSettings => {
  if (maxSide >= 800) return { curveStepCount: 3, maxRandomnessOffset: 0.9, hachureGap: 9 }
  if (maxSide >= 400) return { curveStepCount: 4, maxRandomnessOffset: 1.1, hachureGap: 7 }
  return { curveStepCount: 5, maxRandomnessOffset: 1.3, hachureGap: 5 }
}

/** Map logical stroke style to dash pattern + desired canvas lineCap (set on ctx). */
function mapStrokeStyle(
  strokeStyle: StrokeStyle | undefined,
  strokeWidth: number | undefined
): { strokeLineDash?: number[], lineCap?: CanvasLineCap } {
  const sw = Math.max(0.5, strokeWidth ?? 1)
  switch (strokeStyle) {
    case 'dashed':
      return { strokeLineDash: [5.5 * sw, 4 * sw], lineCap: 'round' }
    case 'dotted':
      return { strokeLineDash: [0, 3 * sw], lineCap: 'round' } // round caps → dots
    case 'solid':
    default:
      return { strokeLineDash: undefined, lineCap: 'butt' }
  }
}

export const RoughTag: React.FC<RoughShapeProps> = ({
  children,
  roughness = 1.2,
  stroke = 'transparent',
  strokeStyle = 'solid',
  strokeWidth = 1,
  fill,
  className,
  seed = 1337,
  widthPx,
  heightPx
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastConfigRef = useRef<DrawConfig | null>(null)
  const rafRef = useRef<number | null>(null)
  const viewportZoom = useGraphStore(state => state.zoom ?? 1)
  const isMoving = useGraphStore(state => state.isMoving)
  const isResizing = useGraphStore(state => state.isResizingNode)
  const effectiveZoom = quantizeZoom(viewportZoom || 1)
  const resolvedWidth = Math.max(1, Math.floor(widthPx ?? 1))
  const resolvedHeight = Math.max(1, Math.floor(heightPx ?? 1))
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const draw = useCallback((wrapper: HTMLDivElement, canvas: HTMLCanvasElement) => {
    if (isMoving && !isResizing) return
    const rect = wrapper.getBoundingClientRect()
    const cssW = Math.max(1, (widthPx ?? wrapper.clientWidth) || Math.floor(rect.width))
    const cssH = Math.max(1, (heightPx ?? wrapper.clientHeight) || Math.floor(rect.height))
    if (cssW === 0 || cssH === 0) return

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const oversample = oversampleForZoom(effectiveZoom)

    const edge = resolveEdgeRender(stroke, fill, isDark, strokeStyle, strokeWidth, roughness)
    const effectiveStrokeWidth = edge.width
    const effectiveStrokeStyle = edge.style
    const effectiveRoughness = edge.roughness

    const bleed = Math.ceil(effectiveStrokeWidth / 2 + effectiveRoughness * 1.5 + 2)
    const paddedWidth = cssW + bleed * 2
    const paddedHeight = cssH + bleed * 2
    const baseScale = dpr * oversample * RENDER_SCALE_FACTOR
    const limiter = Math.min(
      1,
      MAX_RENDER_WIDTH / (paddedWidth * baseScale),
      MAX_RENDER_HEIGHT / (paddedHeight * baseScale)
    )
    const renderScale = baseScale * limiter

    const pixelW = Math.floor(paddedWidth * renderScale)
    const pixelH = Math.floor(paddedHeight * renderScale)
    if (canvas.width !== pixelW) canvas.width = pixelW
    if (canvas.height !== pixelH) canvas.height = pixelH

    canvas.style.width = paddedWidth + 'px'
    canvas.style.height = paddedHeight + 'px'
    canvas.style.left = (-bleed) + 'px'
    canvas.style.top = (-bleed) + 'px'

    const config: DrawConfig = {
      cssW,
      cssH,
      zoom: effectiveZoom,
      roughness: effectiveRoughness,
      stroke: edge.color,
      strokeStyle: effectiveStrokeStyle,
      strokeWidth: effectiveStrokeWidth,
      seed,
      dpr,
      renderScale
    }

    if (drawConfigEqual(lastConfigRef.current, config)) {
      return
    }

    const visibleStroke = edge.color
    const notch = Math.min(cssH * 0.45, cssW * 0.3)
    const radius = Math.min(cssH / 2, cssW / 4, 18)
    const pathData = tagPath(cssW, cssH, notch, radius)

    const { strokeLineDash, lineCap } = mapStrokeStyle(effectiveStrokeStyle, effectiveStrokeWidth)
    const apparentSize = Math.max(cssW, cssH) * Math.min(1, effectiveZoom)
    const { curveStepCount, maxRandomnessOffset } = detailForSize(apparentSize)

    const cacheKey = serializeCacheKey([
      'tag',
      effectiveRoughness,
      visibleStroke,
      effectiveStrokeStyle,
      effectiveStrokeWidth,
      seed,
      effectiveZoom,
      renderScale,
      cssW,
      cssH,
    ])

    const offscreen = getCachedCanvas(cacheKey, pixelW, pixelH, target => {
      const offCtx = target.getContext('2d')
      if (!offCtx) return

      offCtx.setTransform(1, 0, 0, 1, 0, 0)
      offCtx.clearRect(0, 0, target.width, target.height)
      offCtx.setTransform(renderScale, 0, 0, renderScale, 0, 0)
      offCtx.translate(bleed, bleed)

      const rc = new RoughCanvas(target)
      const drawable = rc.generator.path(pathData, {
        roughness: effectiveRoughness,
        stroke: visibleStroke,
        strokeWidth: effectiveStrokeWidth,
        bowing: 2,
        curveStepCount,
        maxRandomnessOffset,
        seed: seed || 1337,
        strokeLineDash,
        strokeLineDashOffset: 0,
        dashOffset: 8,
        dashGap: 16,
        disableMultiStroke: true,
        preserveVertices: true,
      })

      offCtx.save()
      if (lineCap) offCtx.lineCap = lineCap
      offCtx.lineJoin = 'round'
      rc.draw(drawable)
      offCtx.restore()
    })

    if (canvas.width !== offscreen.width) canvas.width = offscreen.width
    if (canvas.height !== offscreen.height) canvas.height = offscreen.height

    canvas.style.width = paddedWidth + 'px'
    canvas.style.height = paddedHeight + 'px'
    canvas.style.left = (-bleed) + 'px'
    canvas.style.top = (-bleed) + 'px'

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(offscreen, 0, 0)

    lastConfigRef.current = config
  }, [roughness, stroke, strokeWidth, fill, isDark, effectiveZoom, seed, strokeStyle, isMoving, isResizing, widthPx, heightPx])

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const wrapper = wrapperRef.current
      const canvas = canvasRef.current
      if (wrapper && canvas) {
        draw(wrapper, canvas)
      }
    })
  }, [draw])

  const mainDivClass = clsx('relative', className || '')
  const isSimplified = isMoving && !isResizing
  const renderEdge = resolveEdgeRender(stroke, fill, isDark, strokeStyle, strokeWidth, roughness)
  // Tag path runs to wrapper edges; fill stays at wrapper edges, stroke center at wrapper edge.
  const fillInset = renderEdge.width / 2

  useEffect(() => {
    if (!isSimplified) {
      lastConfigRef.current = null
      scheduleRedraw()
    }
  }, [isSimplified, scheduleRedraw, widthPx, heightPx])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  return (
    <div ref={wrapperRef} className={mainDivClass}>
      <FillLayer
        kind='tag'
        fill={fill}
        widthPx={resolvedWidth}
        heightPx={resolvedHeight}
        inset={fillInset}
      />
      {isSimplified && (
        <SimplifiedTagOverlay
          edgeColor={renderEdge.color}
          edgeWidth={renderEdge.width}
          edgeStyle={renderEdge.style}
          fillInset={fillInset}
          widthPx={resolvedWidth}
          heightPx={resolvedHeight}
        />
      )}
      <canvas
        ref={canvasRef}
        className='absolute pointer-events-none'
        style={{ zIndex: 10, background: 'transparent', opacity: isSimplified ? 0 : 1 }}
      />
      <div className='relative z-20 w-full h-full'>
        {children}
      </div>
    </div>
  )
}
