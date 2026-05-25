import type { Node, RenderEnv } from "@canvas-harness/core"


/**
 * Document placeholder — bg-card page silhouette with a folded
 * top-right corner. Rounder corners + soft muted stroke match the
 * React view's modern look during pan/zoom.
 */
export const drawDocumentPlaceholder = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  env: RenderEnv,
): void => {
  const { w, h } = node
  const card = (env.theme("card") as string) ?? "#ffffff"
  const stroke = (env.theme("muted-foreground") as string) ?? "#9ca3af"
  const fold = Math.min(w * 0.18, h * 0.18, 28)
  const r = Math.min(12, w * 0.05, h * 0.05)

  ctx.save()
  ctx.fillStyle = card
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  ctx.lineCap = "round"
  ctx.lineJoin = "round"

  // Page body — rounded corners + cut top-right corner.
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(w - fold, 0)
  ctx.lineTo(w, fold)
  ctx.lineTo(w, h - r)
  ctx.quadraticCurveTo(w, h, w - r, h)
  ctx.lineTo(r, h)
  ctx.quadraticCurveTo(0, h, 0, h - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 0.55
  ctx.stroke()

  // Folded-corner indicator — small triangle showing the underside.
  ctx.globalAlpha = 0.35
  ctx.beginPath()
  ctx.moveTo(w - fold, 0)
  ctx.lineTo(w - fold, fold)
  ctx.lineTo(w, fold)
  ctx.closePath()
  ctx.fillStyle = stroke
  ctx.fill()
  ctx.restore()
}
