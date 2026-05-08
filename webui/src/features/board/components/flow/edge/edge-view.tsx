import {
  BaseEdge,
  useReactFlow,
  type EdgeProps
} from '@xyflow/react'
import type { CSSProperties, ReactElement } from 'react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import type { LinkEdge } from '../../../types/flow'
import type { Link } from '../../../types/link'
import type { ArrowheadType, LinkStyle } from '../../../types/style'
import { useTheme } from '@/components/theme-provider'
import { useGraphStore } from '../../../store/graph-store'
import { darkModeDisplayHex } from '../../../lib/colors/dark-variants'
import { EdgeLabel } from './edge-label'
import {
  type Point,
  cssDashArray,
  extractQuadraticSegment,
  pointOnQuadratic,
  quadraticPath,
} from './edge-geometry'
import { useEdgeGeometry } from './use-edge-geometry'
import { useControlPointDrag } from './use-control-point-drag'
import { useRoughPath, hashSeed } from './use-rough-path'
import { useFreehandPath } from './use-freehand-path'
import {
  BASE_HEAD_SIZE,
  HEAD_SCALE,
  TIP_FACTOR,
  BASE_X_FACTOR,
  getMarkerId,
} from './edge-markers'
import { selectEdgeAllSlices, type EdgeNodeSlice } from '../../../utils/edge-node-geometry'
import { estimateEdgeLabelSize } from '../../../utils/edge-label-estimate'

const ARROW_CLEARANCE_FACTOR = 0.5 // pull heads farther from node surface

type EdgeControlPointHandlers = {
  onControlPointChange?: (point: Point) => void
}

type EdgeLabelEditingData = {
  labelEditing?: boolean
  labelDraft?: string
  onLabelChange?: (value: string) => void
  onLabelSave?: () => void
  onLabelCancel?: () => void
}

type EdgeRenderData = Link & EdgeLabelEditingData & EdgeControlPointHandlers


function isFinitePoint(point: Partial<Point> | null | undefined): point is Point {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  )
}


/**
 * Renders an edge between two nodes, with optional arrowheads, label, and control point.
 */
export const EdgeView = memo(function EdgeView({
  id,
  source,
  target,
  style = {},
  data,
  selected
}: EdgeProps<LinkEdge>): ReactElement | null {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const { screenToFlowPosition } = useReactFlow()
  const isMoving = useGraphStore(state => state.isMoving)

  const flat = useGraphStore(useShallow(selectEdgeAllSlices(source, target)))

  const sourceNodeSlice = useMemo<EdgeNodeSlice | null>(
    () => flat.sExists
      ? { x: flat.sx, y: flat.sy, w: flat.sw, h: flat.sh, shape: flat.sShape, attachedToNodeId: flat.sAttachedToId }
      : null,
    [flat.sExists, flat.sx, flat.sy, flat.sw, flat.sh, flat.sShape, flat.sAttachedToId],
  )
  const targetNodeSlice = useMemo<EdgeNodeSlice | null>(
    () => flat.tExists
      ? { x: flat.tx, y: flat.ty, w: flat.tw, h: flat.th, shape: flat.tShape, attachedToNodeId: flat.tAttachedToId }
      : null,
    [flat.tExists, flat.tx, flat.ty, flat.tw, flat.th, flat.tShape, flat.tAttachedToId],
  )
  const attachedSourceNodeSlice = useMemo<EdgeNodeSlice | null>(
    () => flat.asExists
      ? { x: flat.asx, y: flat.asy, w: flat.asw, h: flat.ash, shape: flat.asShape }
      : null,
    [flat.asExists, flat.asx, flat.asy, flat.asw, flat.ash, flat.asShape],
  )
  const attachedTargetNodeSlice = useMemo<EdgeNodeSlice | null>(
    () => flat.atExists
      ? { x: flat.atx, y: flat.aty, w: flat.atw, h: flat.ath, shape: flat.atShape }
      : null,
    [flat.atExists, flat.atx, flat.aty, flat.atw, flat.ath, flat.atShape],
  )
  const [bendPointDrag, setBendPointDrag] = useState<Point | null>(null)

  const edgeExtras = (data ?? {}) as EdgeRenderData

  const edgeData = useMemo(() => {
    const controlPoint = edgeExtras.properties?.edgeControlPoint?.position
    return {
      linkStyle: edgeExtras.style ?? undefined,
      label: edgeExtras.label,
      labelEditing: edgeExtras.labelEditing,
      labelDraft: edgeExtras.labelDraft,
      onControlPointChange: edgeExtras.onControlPointChange,
      onLabelChange: edgeExtras.onLabelChange,
      onLabelSave: edgeExtras.onLabelSave,
      onLabelCancel: edgeExtras.onLabelCancel,
      controlPoint: isFinitePoint(controlPoint) ? controlPoint : null,
    }
  }, [edgeExtras.properties?.edgeControlPoint?.position, edgeExtras.style, edgeExtras.label, edgeExtras.labelEditing, edgeExtras.labelDraft, edgeExtras.onControlPointChange, edgeExtras.onLabelChange, edgeExtras.onLabelSave, edgeExtras.onLabelCancel])

  const linkStyle = edgeData.linkStyle as LinkStyle | undefined

  const baseStroke = linkStyle?.strokeColor ?? '#333333'
  const baseLabelColor = linkStyle?.textColor ?? '#000000'

  const { displayStroke, displayLabelColor } = useMemo(() => {
    if (!isDark) return { displayStroke: baseStroke, displayLabelColor: baseLabelColor }
    return {
      displayStroke: darkModeDisplayHex(baseStroke) ?? '#a5c9ff',
      displayLabelColor: darkModeDisplayHex(baseLabelColor) ?? '#a5c9ff'
    }
  }, [isDark, baseStroke, baseLabelColor])

  const strokeWidth = linkStyle?.strokeWidth ?? 1.5

  const startKind = (linkStyle?.sourceArrowhead ?? 'none') as ArrowheadType
  const endKind = (linkStyle?.targetArrowhead ?? 'none') as ArrowheadType
  const startMarkerId = startKind !== 'none'
    ? getMarkerId(startKind, displayStroke, strokeWidth, 'start')
    : undefined
  const endMarkerId = endKind !== 'none'
    ? getMarkerId(endKind, displayStroke, strokeWidth, 'end')
    : undefined

  // visual arrow length in px (tip to base)
  const headSize = BASE_HEAD_SIZE * HEAD_SCALE
  const arrowLength = headSize * (TIP_FACTOR - BASE_X_FACTOR)
  // pull endpoints back so head sits off the node (scaled with head length)
  const arrowOffset = arrowLength * ARROW_CLEARANCE_FACTOR + 6

  const pathStyle = linkStyle?.pathStyle ?? 'bezier'
  const isBezierPath = pathStyle === 'bezier'

  const storedBendPoint = edgeData.controlPoint

  const {
    geom,
    pathData,
    renderedStart,
    renderedEnd,
    insideSegments,
    bezierPoints,
    displayBendPoint,
    isInvalid
  } = useEdgeGeometry({
    sourceGeom: sourceNodeSlice,
    targetGeom: targetNodeSlice,
    sourceClipGeom: attachedSourceNodeSlice,
    targetClipGeom: attachedTargetNodeSlice,
    linkStyle,
    startKind,
    endKind,
    arrowOffset,
    isBezierPath,
    bendPointDrag,
    storedBendPoint
  })

  const roughSeed = useMemo(() => hashSeed(id ?? `${source}->${target}`), [id, source, target])
  const roughDisabled = isMoving || Boolean(edgeData.labelEditing)
  const isSolidStroke = (linkStyle?.strokeStyle ?? 'solid') === 'solid'
  const freehandDisabled = roughDisabled || !isSolidStroke
  const roughMainPath = useRoughPath(pathData?.path ?? null, {
    seed: roughSeed,
    strokeWidth,
    disabled: roughDisabled || isSolidStroke,
  })
  const freehandMainPath = useFreehandPath(pathData?.path ?? null, {
    strokeWidth,
    disabled: freehandDisabled,
  })

  const dashArray = useMemo(() => cssDashArray(linkStyle, strokeWidth), [linkStyle, strokeWidth])
  const hiddenDashArray = useMemo(() => {
    const sw = Math.max(0.5, strokeWidth)
    return `0 ${3 * sw}`
  }, [strokeWidth])

  const edgeStrokeStyle: CSSProperties = useMemo(
    (): CSSProperties => ({
      ...(style as CSSProperties),
      stroke: displayStroke,
      strokeWidth,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fill: 'none',
      strokeDasharray: dashArray
    }),
    [style, displayStroke, strokeWidth, dashArray]
  )

  const labelText = edgeData.label?.markdown ?? ''
  const hasLabel = Boolean(labelText)
  const isLabelEditing = Boolean(edgeData.labelEditing)
  const labelDraft = isLabelEditing ? edgeData.labelDraft ?? '' : labelText
  const effectiveLabelText = isLabelEditing ? labelDraft : labelText
  const estimatedLabelSize = useMemo(
    () => estimateEdgeLabelSize({
      text: effectiveLabelText,
      fontFamily: linkStyle?.fontFamily,
      maxWidth: 200,
    }),
    [effectiveLabelText, linkStyle?.fontFamily],
  )
  const labelInputRef = useRef<HTMLTextAreaElement | null>(null)
  const skipSaveRef = useRef(false)

  useEffect(() => {
    if (!isLabelEditing) {
      skipSaveRef.current = false
      return
    }
    const raf = requestAnimationFrame(() => {
      labelInputRef.current?.focus()
      labelInputRef.current?.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [isLabelEditing])

  const handleLabelBlur = () => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    edgeData.onLabelSave?.()
  }

  const labelTransformStyle = pathData
    ? { transform: `translate(-50%, -50%) translate(${pathData.labelX}px, ${pathData.labelY}px)` }
    : null

  const handleLabelKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      edgeData.onLabelSave?.()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      skipSaveRef.current = true
      edgeData.onLabelCancel?.()
    }
  }

  const { dragPoint: controlPointDrag, handlePointerDown: handleControlPointPointerDown } =
    useControlPointDrag({
      screenToFlowPosition,
      onCommit: edgeData.onControlPointChange,
    })

  useEffect(() => {
    if (controlPointDrag) {
      setBendPointDrag(controlPointDrag)
      return
    }
    setBendPointDrag(null)
  }, [controlPointDrag])

  const labelGapPaths = useMemo(() => {
    if (!pathData || !bezierPoints) return null
    if (!hasLabel && !isLabelEditing) return null
    if (isLabelEditing) return null

    const padding = 0
    const rectX = pathData.labelX - estimatedLabelSize.width / 2 - padding
    const rectY = pathData.labelY - estimatedLabelSize.height / 2 - padding
    const rectW = estimatedLabelSize.width + padding * 2
    const rectH = estimatedLabelSize.height + padding * 2

    const inside = (p: Point) =>
      p.x >= rectX && p.x <= rectX + rectW && p.y >= rectY && p.y <= rectY + rectH

    const samples = 60
    let t0: number | null = null
    let t1: number | null = null
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples
      const p = pointOnQuadratic(bezierPoints.p0, bezierPoints.p1, bezierPoints.p2, t)
      if (inside(p)) {
        if (t0 === null) t0 = t
        t1 = t
      }
    }

    if (t0 === null || t1 === null || t1 - t0 < 1e-3) return null

    const first = t0 > 1e-3
      ? (() => {
          const seg = extractQuadraticSegment(bezierPoints.p0, bezierPoints.p1, bezierPoints.p2, 0, t0)
          return quadraticPath(seg.p0, seg.p1, seg.p2)
        })()
      : null
    const second = t1 < 1 - 1e-3
      ? (() => {
          const seg = extractQuadraticSegment(bezierPoints.p0, bezierPoints.p1, bezierPoints.p2, t1, 1)
          return quadraticPath(seg.p0, seg.p1, seg.p2)
        })()
      : null

    return {
      first: first?.path ?? null,
      second: second?.path ?? null
    }
  }, [pathData, bezierPoints, estimatedLabelSize, hasLabel, isLabelEditing])

  const roughGapFirst = useRoughPath(labelGapPaths?.first ?? null, {
    seed: roughSeed + 1,
    strokeWidth,
    disabled: roughDisabled || isSolidStroke,
  })
  const roughGapSecond = useRoughPath(labelGapPaths?.second ?? null, {
    seed: roughSeed + 2,
    strokeWidth,
    disabled: roughDisabled || isSolidStroke,
  })
  const freehandGapFirst = useFreehandPath(labelGapPaths?.first ?? null, {
    strokeWidth,
    disabled: freehandDisabled,
  })
  const freehandGapSecond = useFreehandPath(labelGapPaths?.second ?? null, {
    strokeWidth,
    disabled: freehandDisabled,
  })

  if (!geom || !pathData || !renderedStart || !renderedEnd || !labelTransformStyle || isInvalid) {
    return null
  }

  const showControlPoint =
    isBezierPath &&
    !!displayBendPoint &&
    !!edgeData.onControlPointChange &&
    selected &&
    !isLabelEditing

  const freehandFillStyle: CSSProperties = {
    fill: displayStroke,
    stroke: 'none',
  }
  const markerCarrierStyle: CSSProperties = {
    fill: 'none',
    stroke: 'transparent',
    strokeWidth: Math.max(strokeWidth, 1),
  }

  const renderHalf = (
    smoothD: string,
    roughD: string | null,
    freehandD: string | null,
    markerStart?: string,
    markerEnd?: string,
  ) => {
    if (freehandD) {
      return (
        <>
          <path d={freehandD} style={freehandFillStyle} pointerEvents="none" />
          <path
            d={smoothD}
            style={markerCarrierStyle}
            markerStart={markerStart ? `url(#${markerStart})` : undefined}
            markerEnd={markerEnd ? `url(#${markerEnd})` : undefined}
            pointerEvents="none"
          />
        </>
      )
    }
    return (
      <path
        d={roughD ?? smoothD}
        style={edgeStrokeStyle}
        markerStart={markerStart ? `url(#${markerStart})` : undefined}
        markerEnd={markerEnd ? `url(#${markerEnd})` : undefined}
        pointerEvents="none"
      />
    )
  }

  return (
    <>
      {labelGapPaths ? (
        <>
          <BaseEdge
            path={pathData.path}
            style={{
              ...edgeStrokeStyle,
              stroke: 'transparent',
              strokeDasharray: undefined,
              strokeWidth: Math.max(strokeWidth, 12),
            }}
          />
          {labelGapPaths.first && renderHalf(
            labelGapPaths.first,
            roughGapFirst,
            freehandGapFirst,
            startMarkerId,
            undefined,
          )}
          {labelGapPaths.second && renderHalf(
            labelGapPaths.second,
            roughGapSecond,
            freehandGapSecond,
            undefined,
            endMarkerId,
          )}
          {!labelGapPaths.first && labelGapPaths.second && startMarkerId && renderHalf(
            labelGapPaths.second,
            roughGapSecond,
            freehandGapSecond,
            startMarkerId,
            undefined,
          )}
          {!labelGapPaths.second && labelGapPaths.first && endMarkerId && renderHalf(
            labelGapPaths.first,
            roughGapFirst,
            freehandGapFirst,
            undefined,
            endMarkerId,
          )}
        </>
      ) : freehandMainPath ? (
        <>
          <BaseEdge
            path={pathData.path}
            style={{
              ...edgeStrokeStyle,
              stroke: 'transparent',
              strokeDasharray: undefined,
              strokeWidth: Math.max(strokeWidth, 12),
            }}
          />
          <path d={freehandMainPath} style={freehandFillStyle} pointerEvents="none" />
          <path
            d={pathData.path}
            style={markerCarrierStyle}
            markerStart={startMarkerId ? `url(#${startMarkerId})` : undefined}
            markerEnd={endMarkerId ? `url(#${endMarkerId})` : undefined}
            pointerEvents="none"
          />
        </>
      ) : (
        <BaseEdge
          path={roughMainPath ?? pathData.path}
          style={edgeStrokeStyle}
          markerStart={startMarkerId ? `url(#${startMarkerId})` : undefined}
          markerEnd={endMarkerId ? `url(#${endMarkerId})` : undefined}
        />
      )}

      {selected && insideSegments.length > 0 && insideSegments.map((segment, index) => (
        <path
          key={`edge-hidden-${index}`}
          d={segment}
          className='stroke-secondary-foreground'
          style={{
            strokeWidth,
            fill: 'none',
            strokeDasharray: hiddenDashArray,
            strokeLinecap: 'round',
            strokeLinejoin: 'round'
          }}
          pointerEvents="none"
        />
      ))}

      {(isLabelEditing || hasLabel) && (
        <EdgeLabel
          labelText={labelText}
          labelColor={displayLabelColor}
          labelDraft={labelDraft}
          isEditing={isLabelEditing}
          fontFamily={linkStyle?.fontFamily}
          onChange={edgeData.onLabelChange}
          labelInputRef={labelInputRef}
          transformStyle={labelTransformStyle}
          handleLabelBlur={handleLabelBlur}
          handleLabelKeyDown={handleLabelKeyDown}
        />
      )}

      {showControlPoint && (
        <>
          <circle
            cx={displayBendPoint!.x}
            cy={displayBendPoint!.y}
            r={12}
            className='cursor-move fill-transparent'
            pointerEvents='all'
            onPointerDown={handleControlPointPointerDown}
          />
          <circle
            cx={displayBendPoint!.x}
            cy={displayBendPoint!.y}
            r={6}
            className='cursor-move fill-background stroke-secondary-foreground stroke-2'
            pointerEvents='all'
            onPointerDown={handleControlPointPointerDown}
          />
        </>
      )}
    </>
  )
})
