import type { Node, RenderEnv } from "@canvas-harness/core"


/** Paint a lightweight image-card placeholder below the React LOD threshold. */
export function drawImageGeneratorPlaceholder(
  context: CanvasRenderingContext2D,
  node: Node,
  env: RenderEnv,
): void {
  const card = (env.theme("card") as string) ?? "#ffffff"
  const stroke = (env.theme("muted-foreground") as string) ?? "#9ca3af"
  const radius = Math.min(24, node.w * 0.06, node.h * 0.06)

  context.save()
  context.fillStyle = card
  context.strokeStyle = stroke
  context.lineWidth = 1.5
  context.beginPath()
  context.roundRect(0, 0, node.w, node.h, radius)
  context.fill()
  context.globalAlpha = 0.45
  context.stroke()

  const imageW = node.w * 0.56
  const imageH = node.h * 0.34
  const x = (node.w - imageW) / 2
  const y = (node.h - imageH) / 2
  context.globalAlpha = 0.28
  context.strokeRect(x, y, imageW, imageH)
  context.beginPath()
  context.moveTo(x, y + imageH)
  context.lineTo(x + imageW * 0.34, y + imageH * 0.58)
  context.lineTo(x + imageW * 0.54, y + imageH * 0.78)
  context.lineTo(x + imageW * 0.72, y + imageH * 0.48)
  context.lineTo(x + imageW, y + imageH)
  context.stroke()
  context.beginPath()
  context.arc(x + imageW * 0.72, y + imageH * 0.24, Math.max(3, imageW * 0.04), 0, Math.PI * 2)
  context.fillStyle = stroke
  context.fill()
  context.restore()
}
