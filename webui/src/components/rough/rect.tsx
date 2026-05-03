import React, { memo, useCallback, useEffect, useRef } from 'react'
import { RoughCanvas } from 'roughjs/bin/canvas'
import clsx from 'clsx'
import type { StrokeStyle } from '@/features/board/types/style'
import { getCachedCanvas, serializeCacheKey } from './cache'
import { excalidrawRoundedRectPath, rectPath } from './paths'
import { FillLayer } from './fill-layer'
import { useGraphStore } from '@/features/board/store/graph-store'

type RoundedClass = 'none' | 'rounded-2xl'

type RoughRectProps = {
  children?: React.ReactNode
  rounded?: RoundedClass
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
  rounded: RoundedClass
  roughness: number
  stroke: string
  strokeStyle: StrokeStyle
  strokeWidth: number
  seed: number
  dpr: number
  renderScale: number
}

type SimplifiedRectOverlayProps = {
  rounded: RoundedClass
  stroke?: string
  strokeStyle?: StrokeStyle
  strokeWidth?: number
  fillInset: number
  widthPx?: number
  heightPx?: number
}

const SimplifiedRectOverlay = memo(function SimplifiedRectOverlay({
  rounded,
  stroke,
  strokeStyle,
  strokeWidth,
  fillInset,
  widthPx,
  heightPx
}: SimplifiedRectOverlayProps) {
  const { strokeLineDash, lineCap } = mapStrokeStyle(strokeStyle, strokeWidth)
  const dashArray = strokeLineDash ? strokeLineDash.join(' ') : undefined
  const svgWidth = Math.max(1, widthPx ?? 1)
  const svgHeight = Math.max(1, heightPx ?? 1)
  const rectWidth = Math.max(0, svgWidth - fillInset * 2)
  const rectHeight = Math.max(0, svgHeight - fillInset * 2)
  const radius = rounded === 'rounded-2xl' ? 16 : 0
  const cornerRadius = Math.max(0, Math.min(radius, rectWidth / 2, rectHeight / 2))

  return (
    <svg
      className='absolute pointer-events-none'
      style={{ inset: 0, width: '100%', height: '100%', zIndex: 10, overflow: 'visible' }}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      preserveAspectRatio="none"
    >
      <rect
        x={fillInset}
        y={fillInset}
        width={rectWidth}
        height={rectHeight}
        rx={cornerRadius}
        ry={cornerRadius}
        fill='transparent'
        stroke={stroke || 'transparent'}
        strokeWidth={strokeWidth ?? 1}
        strokeDasharray={dashArray}
        strokeLinecap={lineCap}
        vectorEffect='non-scaling-stroke'
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
    a.rounded === b.rounded &&
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

/** Map logical stroke style to dash pattern and (optionally) desired canvas lineCap. */
function mapStrokeStyle(
  strokeStyle: StrokeStyle | undefined,
  strokeWidth: number | undefined
): {
  strokeLineDash?: number[]
  lineCap?: CanvasLineCap
} {
  const sw = Math.max(0.5, strokeWidth ?? 1)

  switch (strokeStyle) {
    case 'dashed':
      return {
        strokeLineDash: [5.5 * sw, 4 * sw],
        lineCap: 'round'
      }
    case 'dotted':
      // Round caps + [0, gap] yields pleasant dots
      return {
        strokeLineDash: [0, 3 * sw],
        lineCap: 'round'
      }
    case 'solid':
    default:
      return {
        strokeLineDash: undefined,
        lineCap: 'butt'
      }
  }
}

/**
 * RoughCanvas-based rectangle component.
 */
export const RoughRect: React.FC<RoughRectProps> = ({
  children,
  rounded = 'none',
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

  const draw = useCallback((wrapper: HTMLDivElement, canvas: HTMLCanvasElement) => {
    const rect = wrapper.getBoundingClientRect()
    const cssW = Math.max(1, (widthPx ?? wrapper.clientWidth) || Math.floor(rect.width))
    const cssH = Math.max(1, (heightPx ?? wrapper.clientHeight) || Math.floor(rect.height))
    if (cssW === 0 || cssH === 0) return

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

    // oversample backing store for zoom-in, clamped to avoid runaway buffers
    const oversample = oversampleForZoom(effectiveZoom)

    const effectiveStrokeWidth = stroke === 'transparent' ? 0 : (strokeWidth ?? 1)
    // add a bleed in CSS units (display px), enough for stroke + jitter
    const bleed = Math.ceil(effectiveStrokeWidth / 2 + (roughness ?? 1.2) * 1.5 + 2)

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
      rounded,
      roughness,
      stroke,
      strokeStyle,
      strokeWidth: effectiveStrokeWidth,
      seed,
      dpr,
      renderScale
    }

    if (drawConfigEqual(lastConfigRef.current, config)) {
      return
    }

    const visibleStroke = stroke === 'transparent' && !fill ? '#222' : stroke

    // hairline crispness without eating tiny boxes; include half stroke so outer edge aligns
    const insetBase = Math.min(0.5, cssW / 4, cssH / 4)
    const inset = insetBase + effectiveStrokeWidth / 2
    const w = Math.max(0, cssW - inset * 2)
    const h = Math.max(0, cssH - inset * 2)

    const baseRadius = rounded === 'rounded-2xl' ? 16 : 0
    const radius = Math.max(0, Math.min(baseRadius, w / 2, h / 2))

    const pathData = radius > 0
      ? excalidrawRoundedRectPath(inset, inset, w, h, radius)
      : rectPath(inset, inset, w, h)

    const { strokeLineDash, lineCap } = mapStrokeStyle(strokeStyle, effectiveStrokeWidth)
    const apparentSize = Math.max(cssW, cssH) * Math.min(1, effectiveZoom)
    const { curveStepCount, maxRandomnessOffset } = detailForSize(apparentSize)

    const cacheKey = serializeCacheKey([
      'rect',
      rounded,
      roughness,
      visibleStroke,
      strokeStyle,
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
        roughness,
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
  }, [rounded, roughness, stroke, strokeWidth, fill, effectiveZoom, seed, strokeStyle, widthPx, heightPx])

  const scheduleRedraw = useCallback(() => {
    if (isMoving) return
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const wrapper = wrapperRef.current
      const canvas = canvasRef.current
      if (wrapper && canvas) {
        draw(wrapper, canvas)
      }
    })
  }, [draw, isMoving])

  const isSimplified = isMoving && !isResizing

  useEffect(() => {
    if (isSimplified) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }
    lastConfigRef.current = null
    scheduleRedraw()
  }, [isSimplified, scheduleRedraw, widthPx, heightPx])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  const mainDivClass = clsx('relative', className || '')
  const fillKind = rounded === 'rounded-2xl' ? 'rect-rounded' : 'rect-sharp'
  const renderEffectiveStrokeWidth = stroke === 'transparent' ? 0 : (strokeWidth ?? 1)
  const fillInset = 0.5 + renderEffectiveStrokeWidth / 2

  if (isSimplified) {
    return (
      <div className={mainDivClass}>
        <FillLayer
          kind={fillKind}
          fill={fill}
          widthPx={widthPx ?? 1}
          heightPx={heightPx ?? 1}
          cornerRadius={16}
          inset={fillInset}
        />
        <SimplifiedRectOverlay
          rounded={rounded}
          stroke={stroke}
          strokeStyle={strokeStyle}
          strokeWidth={strokeWidth}
          fillInset={fillInset}
          widthPx={widthPx}
          heightPx={heightPx}
        />
        <div className='relative z-20 w-full h-full'>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className={mainDivClass}>
      <FillLayer
        kind={fillKind}
        fill={fill}
        widthPx={widthPx ?? 1}
        heightPx={heightPx ?? 1}
        cornerRadius={16}
        inset={fillInset}
      />
      <canvas
        ref={canvasRef}
        className='absolute pointer-events-none'
        style={{ zIndex: 10, background: 'transparent' }}
      />
      <div className='relative z-20 w-full h-full'>
        {children}
      </div>
    </div>
  )
}

