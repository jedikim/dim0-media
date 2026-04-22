import { useMemo } from 'react'
import { getStroke } from 'perfect-freehand'


type Point = [number, number]


/**
 * Sample an SVG `d` (M/L/Q only) into a dense point list along the path.
 * Quadratic segments are subdivided into `samples` pieces per command.
 */
function samplePathToPoints(d: string, samples = 24): Point[] {
  const tokens = d.match(/[MLQZmlqz]|-?\d*\.?\d+(?:e[+-]?\d+)?/gi)
  if (!tokens) return []
  const points: Point[] = []
  let cx = 0
  let cy = 0
  let i = 0
  while (i < tokens.length) {
    const cmd = tokens[i]
    i += 1
    if (cmd === 'M' || cmd === 'm' || cmd === 'L' || cmd === 'l') {
      const x = parseFloat(tokens[i]); i += 1
      const y = parseFloat(tokens[i]); i += 1
      cx = x; cy = y
      points.push([x, y])
    } else if (cmd === 'Q' || cmd === 'q') {
      const x1 = parseFloat(tokens[i]); i += 1
      const y1 = parseFloat(tokens[i]); i += 1
      const x2 = parseFloat(tokens[i]); i += 1
      const y2 = parseFloat(tokens[i]); i += 1
      for (let s = 1; s <= samples; s += 1) {
        const t = s / samples
        const u = 1 - t
        const sx = u * u * cx + 2 * u * t * x1 + t * t * x2
        const sy = u * u * cy + 2 * u * t * y1 + t * t * y2
        points.push([sx, sy])
      }
      cx = x2; cy = y2
    } else if (cmd === 'Z' || cmd === 'z') {
      // ignore
    } else {
      return []
    }
  }
  return points
}


/**
 * Convert a ring of polygon vertices from perfect-freehand into a closed SVG
 * path `d`. Uses quadratic midpoints for soft corners (same trick tldraw uses).
 */
function outlineToSvgPath(stroke: number[][]): string {
  if (stroke.length === 0) return ''
  if (stroke.length < 3) {
    const [first] = stroke
    return `M ${first[0].toFixed(2)} ${first[1].toFixed(2)} Z`
  }
  const parts: string[] = []
  const [x0, y0] = stroke[0]
  parts.push(`M ${x0.toFixed(2)} ${y0.toFixed(2)}`)
  for (let i = 0; i < stroke.length; i += 1) {
    const [x1, y1] = stroke[i]
    const [x2, y2] = stroke[(i + 1) % stroke.length]
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    parts.push(`Q ${x1.toFixed(2)} ${y1.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`)
  }
  parts.push('Z')
  return parts.join(' ')
}


type UseFreehandPathOptions = {
  strokeWidth: number
  disabled?: boolean
}


/**
 * Produce a tapered, hand-drawn SVG `d` (a filled polygon outline) from an
 * input path `d`. Samples the path, runs perfect-freehand with a pressure
 * profile that's thin at the endpoints and fatter in the middle, then closes
 * the outline. Returns `null` when disabled or on failure — caller should fall
 * back to the normal stroked render.
 */
export function useFreehandPath(
  d: string | null | undefined,
  { strokeWidth, disabled }: UseFreehandPathOptions,
): string | null {
  return useMemo(() => {
    if (!d || disabled) return null
    try {
      const rawPoints = samplePathToPoints(d)
      if (rawPoints.length < 2) return null

      // pressure profile: slight ramp-in, steady middle, slight ramp-out
      const withPressure = rawPoints.map(([x, y], i) => {
        const t = i / (rawPoints.length - 1 || 1)
        const bell = Math.sin(Math.PI * t)
        const pressure = 0.35 + 0.55 * bell
        return [x, y, pressure] as [number, number, number]
      })

      const size = Math.max(1.2, strokeWidth) * 1.3
      const stroke = getStroke(withPressure, {
        size,
        thinning: 0.55,
        smoothing: 0.6,
        streamline: 0.55,
        simulatePressure: false,
        last: true,
        start: { taper: Math.min(24, size * 3), cap: true },
        end: { taper: Math.min(24, size * 3), cap: true },
      })
      if (!stroke || stroke.length === 0) return null
      return outlineToSvgPath(stroke)
    } catch {
      return null
    }
  }, [d, strokeWidth, disabled])
}
