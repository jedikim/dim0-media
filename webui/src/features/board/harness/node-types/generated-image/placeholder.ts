import type { Node, RenderEnv } from "@canvas-harness/core"


/** Paint a bounded image silhouette below the React LOD threshold. */
export function drawGeneratedImagePlaceholder(
  context: CanvasRenderingContext2D,
  node: Node,
  env: RenderEnv,
): void {
  const card = (env.theme("card") as string) ?? "#ffffff"
  const stroke = (env.theme("muted-foreground") as string) ?? "#9ca3af"
  const radius = Math.min(18, node.w * 0.05, node.h * 0.05)
  context.save()
  context.fillStyle = card
  context.strokeStyle = stroke
  context.lineWidth = 1.5
  context.beginPath()
  context.roundRect(0, 0, node.w, node.h, radius)
  context.fill()
  context.globalAlpha = 0.45
  context.stroke()
  context.beginPath()
  context.moveTo(node.w * 0.08, node.h * 0.82)
  context.lineTo(node.w * 0.38, node.h * 0.48)
  context.lineTo(node.w * 0.56, node.h * 0.68)
  context.lineTo(node.w * 0.75, node.h * 0.38)
  context.lineTo(node.w * 0.92, node.h * 0.82)
  context.stroke()
  context.beginPath()
  context.arc(node.w * 0.72, node.h * 0.24, Math.max(3, node.w * 0.035), 0, Math.PI * 2)
  context.fillStyle = stroke
  context.fill()
  context.restore()
}
