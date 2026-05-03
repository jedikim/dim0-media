import { memo, type CSSProperties } from 'react'
import {
  excalidrawRoundedRectPath,
  roundedDiamondPath,
  sharpDiamondPath,
  tagPath,
} from './paths'


export type FillLayerKind =
  | 'rect-sharp'
  | 'rect-rounded'
  | 'ellipse'
  | 'diamond-sharp'
  | 'diamond-rounded'
  | 'tag'


type FillLayerProps = {
  kind: FillLayerKind
  fill?: string
  widthPx: number
  heightPx: number
  cornerRadius?: number
  notch?: number
  inset?: number
  zIndex?: number
}


const MISREGISTER_TRANSFORM =
  'translate(var(--shape-misregister-x, 0px), var(--shape-misregister-y, 0px))'


/**
 * CSS/SVG fill layer for rough.js shapes. Replaces the rough.js fill pass with
 * a cheap GPU-composited layer so fill colour changes don't bust the rough cache.
 *
 * `inset` aligns the fill edges with the rough stroke center (so fill underlies
 * the stroke without showing past it before misregistration). Honours the
 * `--shape-misregister-x/y` CSS variables for the print-misregistration effect.
 */
export const FillLayer = memo(function FillLayer({
  kind,
  fill,
  widthPx,
  heightPx,
  cornerRadius = 0,
  notch,
  inset = 0,
  zIndex = 5,
}: FillLayerProps) {
  if (!fill || fill === 'transparent') return null

  const insetPx = Math.max(0, inset)
  const baseStyle: CSSProperties = {
    position: 'absolute',
    top: insetPx,
    right: insetPx,
    bottom: insetPx,
    left: insetPx,
    pointerEvents: 'none',
    zIndex,
    transform: MISREGISTER_TRANSFORM,
  }

  if (kind === 'rect-sharp' || kind === 'rect-rounded' || kind === 'ellipse') {
    const radius =
      kind === 'ellipse' ? '50%'
      : kind === 'rect-rounded' ? `${cornerRadius || 16}px`
      : '0'
    return (
      <div
        aria-hidden='true'
        style={{ ...baseStyle, background: fill, borderRadius: radius }}
      />
    )
  }

  const innerW = Math.max(1, widthPx - insetPx * 2)
  const innerH = Math.max(1, heightPx - insetPx * 2)
  const pathData = pathFor(kind, innerW, innerH, cornerRadius, notch)

  return (
    <svg
      aria-hidden='true'
      style={baseStyle}
      width='100%'
      height='100%'
      viewBox={`0 0 ${innerW} ${innerH}`}
      preserveAspectRatio='none'
    >
      <path d={pathData} fill={fill} />
    </svg>
  )
})


function pathFor(
  kind: FillLayerKind,
  w: number,
  h: number,
  cornerRadius: number,
  notch: number | undefined,
): string {
  switch (kind) {
    case 'diamond-sharp':
      return sharpDiamondPath(0, 0, w, h)
    case 'diamond-rounded':
      return roundedDiamondPath(0, 0, w, h, cornerRadius || 16)
    case 'tag': {
      const n = notch ?? Math.min(h * 0.45, w * 0.3)
      const r = Math.min(h / 2, w / 4, 18)
      return tagPath(w, h, n, r)
    }
    case 'rect-sharp':
      return `M0 0 H${w} V${h} H0 Z`
    case 'rect-rounded':
      return excalidrawRoundedRectPath(0, 0, w, h, cornerRadius || 16)
    case 'ellipse': {
      const cx = w / 2
      const cy = h / 2
      const rx = w / 2
      const ry = h / 2
      return `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`
    }
  }
}
