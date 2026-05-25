import type { Node, RenderEnv } from "@canvas-harness/core"


/**
 * Folder placeholder painted on the canvas while panning/zooming or
 * when zoomed out below the React-view threshold. The folder
 * silhouette (tab + body) is what identifies the type at a glance;
 * fill = `card`, stroke = soft muted-foreground for a calm, modern
 * look that matches the React view's bg-card aesthetic.
 */
export const drawFolderPlaceholder = (
  ctx: CanvasRenderingContext2D,
  node: Node,
  env: RenderEnv,
): void => {
  const { w, h } = node
  const card = (env.theme("card") as string) ?? "#ffffff"
  const stroke = (env.theme("muted-foreground") as string) ?? "#9ca3af"
  const tabW = Math.min(w * 0.35, w * 0.6)
  const tabH = Math.min(h * 0.18, 28)
  const r = Math.min(14, w * 0.05, h * 0.05)
  const tabSkew = tabH * 0.4

  ctx.save()
  ctx.fillStyle = card
  ctx.strokeStyle = stroke
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 1.5
  ctx.lineCap = "round"
  ctx.lineJoin = "round"

  // Tab — soft trapezoid on the top-left.
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(tabW - tabSkew, 0)
  ctx.lineTo(tabW, tabH)
  ctx.lineTo(0, tabH)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.globalAlpha = 1
  ctx.fillStyle = card
  ctx.fill()
  ctx.globalAlpha = 0.55
  ctx.stroke()

  // Body — rounded rect occupying everything below the tab.
  const bodyY = tabH
  ctx.beginPath()
  ctx.moveTo(r, bodyY)
  ctx.lineTo(w - r, bodyY)
  ctx.quadraticCurveTo(w, bodyY, w, bodyY + r)
  ctx.lineTo(w, h - r)
  ctx.quadraticCurveTo(w, h, w - r, h)
  ctx.lineTo(r, h)
  ctx.quadraticCurveTo(0, h, 0, h - r)
  ctx.lineTo(0, bodyY)
  ctx.closePath()
  ctx.globalAlpha = 1
  ctx.fill()
  ctx.globalAlpha = 0.55
  ctx.stroke()
  ctx.restore()
}
