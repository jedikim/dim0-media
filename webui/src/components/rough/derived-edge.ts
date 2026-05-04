import type { StrokeStyle } from '@/features/board/types/style'
import { darkerDisplayHex, lighterDisplayHex } from '@/features/board/lib/colors/dark-variants'
import { isTransparent } from '@/features/board/lib/colors/tailwind'


/** Mid preset from StrokeWidthPresets ([1, 2, 4]). */
export const DERIVED_EDGE_WIDTH = 2


/** Mid preset from SloppyPresets ([0, 0.5, 1]) — keeps the misregistration sketchy. */
export const DERIVED_EDGE_ROUGHNESS = 0.5


export type ResolvedEdge = {
  color: string
  width: number
  style: StrokeStyle
  roughness: number
  isDerived: boolean
}


/**
 * Resolve the visible border for a rough shape, accounting for the
 * "no border + has fill" case used by the Spider-Verse misregistration trick.
 *
 * - Transparent stroke + fill → derive a tonal-shifted edge from the fill
 *   (light theme: lighter than fill, dark theme: darker than fill), pinned
 *   to solid + mid stroke width + mid roughness so toggling style/width/sloppiness
 *   while the border is off doesn't leak into the derived edge later.
 * - Transparent stroke + no fill → width 0, style solid (cache-stable, invisible).
 * - Otherwise: pass through stroke / strokeWidth / strokeStyle / roughness.
 */
export const resolveEdgeRender = (
  stroke: string | undefined,
  fill: string | undefined,
  isDark: boolean,
  strokeStyle: StrokeStyle | undefined,
  strokeWidth: number | undefined,
  roughness: number | undefined,
): ResolvedEdge => {
  const hasFill = !!fill && !isTransparent(fill)
  const strokeIsTransparent = isTransparent(stroke)

  if (strokeIsTransparent && hasFill) {
    const tonal = isDark ? darkerDisplayHex(fill) : lighterDisplayHex(fill)
    return {
      color: tonal ?? fill ?? '#222',
      width: DERIVED_EDGE_WIDTH,
      style: 'solid',
      roughness: DERIVED_EDGE_ROUGHNESS,
      isDerived: true,
    }
  }

  if (strokeIsTransparent) {
    return {
      color: '#222',
      width: 0,
      style: 'solid',
      roughness: roughness ?? 1.2,
      isDerived: false,
    }
  }

  return {
    color: stroke ?? '#222',
    width: strokeWidth ?? 1,
    style: strokeStyle ?? 'solid',
    roughness: roughness ?? 1.2,
    isDerived: false,
  }
}
