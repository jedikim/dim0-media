import { defineNode } from "@canvas-harness/core"
import { drawWidgetPlaceholder } from "./placeholder"
import { WidgetView } from "./view"


/**
 * Widget node — inline HTML/JS embed rendered as an iframe. The iframe
 * is expensive to mount; the LOD threshold for React view sits high
 * (0.6) so iframes only render when the user has zoomed in. Below
 * that, the placeholder paint runs.
 */
export const widgetDef = defineNode({
  type: "widget",
  view: WidgetView,
  drawPlaceholder: drawWidgetPlaceholder,
  lod: { minZoomForReact: 0.6, minZoomForPlaceholder: 0.05 },
  hitTest: (node, p) => p.x >= 0 && p.x <= node.w && p.y >= 0 && p.y <= node.h,
})
