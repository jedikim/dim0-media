import type { Node, RenderEnv } from "@canvas-harness/core"


/**
 * Sheet placeholder — bg-card rounded card with a few soft horizontal
 * lines to hint at long-form text. Matches the React view's
 * sticky-note look so the transition into motion is smooth.
 */
export const drawSheetPlaceholder = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  env: RenderEnv,
): void => {
  const { w, h } = node
  const card = (env.theme("card") as string) ?? "#ffffff"
  const stroke = (env.theme("muted-foreground") as string) ?? "#9ca3af"
  const r = Math.min(16, w * 0.06, h * 0.06)

  ctx.save()
  ctx.fillStyle = card
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  ctx.lineCap = "round"
  ctx.lineJoin = "round"

  // Rounded card body.
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(w - r, 0)
  ctx.quadraticCurveTo(w, 0, w, r)
  ctx.lineTo(w, h - r)
  ctx.quadraticCurveTo(w, h, w - r, h)
  ctx.lineTo(r, h)
  ctx.quadraticCurveTo(0, h, 0, h - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 0.5
  ctx.stroke()

  // A few centered horizontal "text" lines so the silhouette reads
  // as a sheet without showing real content.
  ctx.globalAlpha = 0.35
  ctx.lineWidth = 2
  const padX = Math.max(16, w * 0.12)
  const lineCount = 4
  const lineSpacing = Math.min(14, h * 0.12)
  const totalH = (lineCount - 1) * lineSpacing
  const startY = h / 2 - totalH / 2
  const widths = [1, 0.7, 0.9, 0.55]
  for (let i = 0; i < lineCount; i += 1) {
    const y = startY + i * lineSpacing
    const lineW = (w - padX * 2) * widths[i]
    ctx.beginPath()
    ctx.moveTo(padX, y)
    ctx.lineTo(padX + lineW, y)
    ctx.stroke()
  }
  ctx.restore()
}
