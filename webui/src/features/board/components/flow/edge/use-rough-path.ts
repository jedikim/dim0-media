import { useMemo } from 'react'
import { RoughGenerator } from 'roughjs/bin/generator'
import type { Point } from 'roughjs/bin/geometry'


let generatorInstance: RoughGenerator | null = null


function getGenerator(): RoughGenerator {
  if (!generatorInstance) generatorInstance = new RoughGenerator()
  return generatorInstance
}


/**
 * Deterministic hash → positive integer seed for rough.js.
 */
export function hashSeed(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h) ^ input.charCodeAt(i)
  }
  return Math.abs(h) % 2_000_000_000 || 1
}


/**
 * Sample an SVG `d` (M/L/Q only) into a point list along the path. Quadratic
 * segments are subdivided into `samples` pieces. Points feed rough.js's
 * `curve`/`linearPath`, which produce a single continuous sketchy stroke —
 * unlike `generator.path`, which jitters bezier control points and looks
 * smooth, or a polyline-`d` route, which renders as disconnected scribbles.
 */
function samplePathToPoints(d: string, samples = 3): Point[] {
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


type UseRoughPathOptions = {
  seed: number
  roughness?: number
  bowing?: number
  strokeWidth: number
  disabled?: boolean
}


/**
 * Produce a sketchy SVG `d` variant of the input path. Samples the path into
 * points, then uses rough.js's curve/linearPath to emit a single continuous
 * hand-drawn stroke. Returns the input `d` when disabled or on failure.
 */
export function useRoughPath(
  d: string | null | undefined,
  { seed, roughness = 1.2, bowing = 1, strokeWidth, disabled }: UseRoughPathOptions,
): string | null {
  return useMemo(() => {
    if (!d) return null
    if (disabled) return d
    try {
      const generator = getGenerator()
      const points = samplePathToPoints(d)
      if (points.length < 2) return d
      const options = {
        roughness,
        bowing,
        stroke: '#000',
        strokeWidth,
        seed: seed || 1,
        disableMultiStroke: true,
        preserveVertices: false,
      }
      const drawable = points.length >= 3
        ? generator.curve(points, options)
        : generator.linearPath(points, options)
      const strokeSet = drawable.sets.find(set => set.type === 'path')
      if (!strokeSet) return d
      return generator.opsToPath(strokeSet, 2)
    } catch {
      return d
    }
  }, [d, seed, roughness, bowing, strokeWidth, disabled])
}
