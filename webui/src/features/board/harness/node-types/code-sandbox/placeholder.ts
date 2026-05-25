import type { Node, RenderEnv } from "@canvas-harness/core"


/**
 * Code-sandbox placeholder — bg-card rounded card with a centered
 * `< >` bracket glyph + a few code-line strokes. Drops the dark
 * rose-pine background during motion so the canvas reads as a calm
 * card on the rest of the canvas surface.
 */
export const drawCodeSandboxPlaceholder = (
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

  // Centered `< / >` glyph — three strokes forming the code icon.
  ctx.globalAlpha = 0.4
  ctx.lineWidth = 2.5
  ctx.strokeStyle = stroke
  const glyphSize = Math.min(w * 0.28, h * 0.42, 56)
  const cx = w / 2
  const cy = h / 2
  const half = glyphSize / 2
  const armX = glyphSize * 0.35
  const armY = glyphSize * 0.3

  // Left bracket: <
  ctx.beginPath()
  ctx.moveTo(cx - half * 0.55, cy - armY)
  ctx.lineTo(cx - half * 0.55 - armX, cy)
  ctx.lineTo(cx - half * 0.55, cy + armY)
  ctx.stroke()

  // Right bracket: >
  ctx.beginPath()
  ctx.moveTo(cx + half * 0.55, cy - armY)
  ctx.lineTo(cx + half * 0.55 + armX, cy)
  ctx.lineTo(cx + half * 0.55, cy + armY)
  ctx.stroke()

  // Forward slash between the brackets.
  ctx.beginPath()
  ctx.moveTo(cx + glyphSize * 0.12, cy - armY * 1.1)
  ctx.lineTo(cx - glyphSize * 0.12, cy + armY * 1.1)
  ctx.stroke()
  ctx.restore()
}
