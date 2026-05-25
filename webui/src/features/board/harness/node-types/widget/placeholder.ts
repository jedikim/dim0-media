import type { Node, RenderEnv } from "@canvas-harness/core"


/**
 * Widget placeholder — bg-card rounded card with a centered bar-chart
 * glyph. Reads as "interactive embed" at a glance without paying the
 * cost of mounting the actual iframe during motion.
 */
export const drawWidgetPlaceholder = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  env: RenderEnv,
): void => {
  const { w, h } = node
  const card = (env.theme("card") as string) ?? "#ffffff"
  const stroke = (env.theme("muted-foreground") as string) ?? "#9ca3af"
  const r = Math.min(24, w * 0.06, h * 0.06)

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

  // Centered bar-chart glyph — 4 rounded bars at varying heights.
  ctx.globalAlpha = 0.35
  ctx.fillStyle = stroke
  const chartW = Math.min(w * 0.5, 120)
  const chartH = Math.min(h * 0.5, 90)
  const bars = [0.45, 0.85, 0.6, 1.0]
  const barCount = bars.length
  const totalGap = chartW * 0.25
  const barW = (chartW - totalGap) / barCount
  const gap = totalGap / (barCount - 1)
  const baseY = h / 2 + chartH / 2
  const startX = w / 2 - chartW / 2
  const barR = Math.min(3, barW / 4)
  for (let i = 0; i < barCount; i += 1) {
    const bh = chartH * bars[i]
    const x = startX + i * (barW + gap)
    const y = baseY - bh
    // Rounded top corners only (bottom sits on the baseline).
    ctx.beginPath()
    ctx.moveTo(x, baseY)
    ctx.lineTo(x, y + barR)
    ctx.quadraticCurveTo(x, y, x + barR, y)
    ctx.lineTo(x + barW - barR, y)
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + barR)
    ctx.lineTo(x + barW, baseY)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}
