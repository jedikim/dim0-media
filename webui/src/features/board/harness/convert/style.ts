import type {
  Style as CanvasStyle,
  EdgeStyle as CanvasEdgeStyle,
  TextStyle as CanvasTextStyle,
} from "@canvas-harness/core"
import type {
  Style as Dim0Style,
  BaseStyle as Dim0BaseStyle,
  LinkStyle as Dim0LinkStyle,
  TextStyle as Dim0TextStyle,
  FillStyle,
} from "@/features/board/types/style"


/**
 * Style conversion between Dim0's legacy react-flow shape and the
 * canvas-harness Style / EdgeStyle.
 *
 * Differences worth knowing (see migration-canvas-harness.md §3.3):
 *  - Opacity: both Dim0 and canvas-harness use the 0-100 scale.
 *    The lib's resolveOpacity divides by 100 internally, so we pass
 *    the value straight through (don't pre-divide — that would
 *    double-scale and make everything ~1% alpha).
 *  - Dim0 carries `type`, `angle`, `groupIds` on Style; canvas-harness
 *    lifts those onto Node / Edge — handled in noteToNode / linkToEdge.
 *  - `fillStyle` (hachure / cross-hatch / zigzag / dots) and TextStyle
 *    `underline` / `strikethrough` are silently dropped — product policy
 *    is solid fills + canvas-harness's text styles only.
 */


const clampTextStyle = (s: Dim0TextStyle | undefined): CanvasTextStyle => {
  if (s === "bold" || s === "italic") return s
  return "normal"
}


/** Convert a Dim0 BaseStyle (node or link) → canvas-harness Style (excluding lifted fields). */
export const dim0StyleToCanvas = (s: Dim0BaseStyle): CanvasStyle => ({
  strokeColor: s.strokeColor,
  strokeWidth: s.strokeWidth,
  strokeStyle: s.strokeStyle,
  backgroundColor: s.backgroundColor,
  roughness: s.roughness,
  roundness: s.roundness,
  opacity: s.opacity,
  fontFamily: s.fontFamily,
  fontSize: s.fontSize,
  textAlign: s.textAlign,
  textColor: s.textColor,
  textStyle: clampTextStyle(s.textStyle),
})


/** Convert Dim0 link Style → canvas-harness EdgeStyle. */
export const dim0LinkStyleToCanvas = (s: Dim0LinkStyle): CanvasEdgeStyle => ({
  ...dim0StyleToCanvas(s),
  sourceArrowhead: s.sourceArrowhead,
  targetArrowhead: s.targetArrowhead,
})


type StyleCarry = {
  type: Dim0Style["type"]
  angle: number
  groupIds: string[]
  fillStyle?: FillStyle
}


/** Convert canvas-harness Style → Dim0 Style. Caller supplies the lifted fields. */
export const canvasStyleToDim0 = (s: CanvasStyle | undefined, carry: StyleCarry): Dim0Style => ({
  type: carry.type,
  angle: carry.angle,
  groupIds: carry.groupIds,
  fillStyle: carry.fillStyle ?? "solid",
  strokeColor: s?.strokeColor ?? "#00000000",
  strokeWidth: s?.strokeWidth ?? 2,
  strokeStyle: s?.strokeStyle ?? "solid",
  backgroundColor: s?.backgroundColor ?? "#dbeafe",
  roughness: s?.roughness ?? 0,
  roundness: s?.roundness ?? 0,
  opacity: s?.opacity ?? 100,
  fontFamily: s?.fontFamily ?? "sans-serif",
  fontSize: s?.fontSize ?? "M",
  textAlign: s?.textAlign ?? "center",
  textColor: s?.textColor ?? "#000000",
  textStyle: s?.textStyle ?? "normal",
})


type EdgeStyleCarry = {
  angle: number
  groupIds: string[]
  pathStyle: Dim0LinkStyle["pathStyle"]
}


/** Convert canvas-harness EdgeStyle → Dim0 LinkStyle. Caller supplies lifted fields. */
export const canvasEdgeStyleToDim0Link = (
  s: CanvasEdgeStyle | undefined,
  carry: EdgeStyleCarry,
): Dim0LinkStyle => ({
  type: "arrow",
  angle: carry.angle,
  groupIds: carry.groupIds,
  fillStyle: "solid",
  strokeColor: s?.strokeColor ?? "#292524",
  strokeWidth: s?.strokeWidth ?? 2,
  strokeStyle: s?.strokeStyle ?? "solid",
  backgroundColor: s?.backgroundColor ?? "#00000000",
  roughness: s?.roughness ?? 1,
  roundness: s?.roundness ?? 0,
  opacity: s?.opacity ?? 100,
  fontFamily: s?.fontFamily ?? "handwriting",
  fontSize: s?.fontSize ?? "M",
  textAlign: s?.textAlign ?? "center",
  textColor: s?.textColor ?? "#000000",
  textStyle: s?.textStyle ?? "normal",
  sourceArrowhead: s?.sourceArrowhead ?? "none",
  targetArrowhead: s?.targetArrowhead ?? "arrow-filled",
  pathStyle: carry.pathStyle,
})
