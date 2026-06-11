import { defineNode } from "@canvas-harness/core"

import { drawMiniAppPlaceholder } from "./placeholder"
import { MiniAppView } from "./view"


/**
 * Mini-app node — sandboxed-iframe-rendered React component.
 *
 * LOD threshold is lower than the HTML widget's (0.25 vs 0.6) because
 * mini-apps tend to grow tall via the canvas auto-grow path
 * (view.tsx → store.updateNode). Users routinely zoom out to take in
 * a multi-section dashboard widget in context; cutting React off too
 * early defeats that — the placeholder is just a static icon, not
 * the widget. The off-screen suspension in view.tsx (useIsInView)
 * still bounds memory because only mini-apps actually inside the
 * viewport at any zoom level pay the iframe-mount cost.
 *
 * Sibling thresholds for reference (Jun 2026):
 * - widget (HTML iframe): 0.6
 * - code-sandbox: 0.5
 * - document, folder: 0.4
 * - sheet, mini-app (this): 0.25
 */
export const miniAppDef = defineNode({
  type: "mini-app",
  view: MiniAppView,
  drawPlaceholder: drawMiniAppPlaceholder,
  lod: { minZoomForReact: 0.25, minZoomForPlaceholder: 0.05 },
  hitTest: (node, p) => p.x >= 0 && p.x <= node.w && p.y >= 0 && p.y <= node.h,
})
