// Mini-app canvas placeholder.
//
// Drawn instead of the React view when the user is zoomed out below
// `minZoomForReact` (see def.ts). Same overall card style as the HTML
// widget placeholder, but with a different glyph — a stylized cursor
// over a small panel — to read as "interactive app" at a glance vs the
// widget's bar-chart glyph.

import type { Node, RenderEnv } from "@canvas-harness/core"


export const drawMiniAppPlaceholder = (
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

  // Inner panel + a small "button" rectangle below it — reads as a
  // mini-app surface (panel + control).
  ctx.globalAlpha = 0.35
  ctx.fillStyle = stroke
  const panelW = Math.min(w * 0.55, 140)
  const panelH = Math.min(h * 0.35, 60)
  const buttonW = panelW * 0.5
  const buttonH = panelH * 0.3
  const gap = panelH * 0.2

  const totalH = panelH + gap + buttonH
  const startY = h / 2 - totalH / 2

  // Panel
  const panelX = w / 2 - panelW / 2
  const panelR = Math.min(6, panelH / 4)
  ctx.beginPath()
  ctx.moveTo(panelX + panelR, startY)
  ctx.lineTo(panelX + panelW - panelR, startY)
  ctx.quadraticCurveTo(panelX + panelW, startY, panelX + panelW, startY + panelR)
  ctx.lineTo(panelX + panelW, startY + panelH - panelR)
  ctx.quadraticCurveTo(panelX + panelW, startY + panelH, panelX + panelW - panelR, startY + panelH)
  ctx.lineTo(panelX + panelR, startY + panelH)
  ctx.quadraticCurveTo(panelX, startY + panelH, panelX, startY + panelH - panelR)
  ctx.lineTo(panelX, startY + panelR)
  ctx.quadraticCurveTo(panelX, startY, panelX + panelR, startY)
  ctx.closePath()
  ctx.fill()

  // Button
  const buttonX = w / 2 - buttonW / 2
  const buttonY = startY + panelH + gap
  const buttonR = Math.min(4, buttonH / 3)
  ctx.beginPath()
  ctx.moveTo(buttonX + buttonR, buttonY)
  ctx.lineTo(buttonX + buttonW - buttonR, buttonY)
  ctx.quadraticCurveTo(buttonX + buttonW, buttonY, buttonX + buttonW, buttonY + buttonR)
  ctx.lineTo(buttonX + buttonW, buttonY + buttonH - buttonR)
  ctx.quadraticCurveTo(buttonX + buttonW, buttonY + buttonH, buttonX + buttonW - buttonR, buttonY + buttonH)
  ctx.lineTo(buttonX + buttonR, buttonY + buttonH)
  ctx.quadraticCurveTo(buttonX, buttonY + buttonH, buttonX, buttonY + buttonH - buttonR)
  ctx.lineTo(buttonX, buttonY + buttonR)
  ctx.quadraticCurveTo(buttonX, buttonY, buttonX + buttonR, buttonY)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}
