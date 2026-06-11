import { defineNode } from "@canvas-harness/core"
import { drawSheetPlaceholder } from "./placeholder"
import { SheetView } from "./view"


/**
 * Sheet node — long-form rich-text document (TipTap editor in the
 * modal surface, same pipeline used inline in the canvas card).
 *
 * LOD threshold is 0.25 (down from 0.4): the placeholder paint shows
 * only abstract horizontal lines (placeholder.ts), so cutting React
 * off too early defeats the user's reason to zoom out — "let me skim
 * multiple sheets at once." Tiptap + ProseMirror libraries are
 * loaded once for the whole app; each mounted sheet only adds its
 * own ~1-2 MB editor instance, much cheaper than a mini-app iframe,
 * and the off-screen `useIsInView` suspension still bounds memory by
 * only mounting sheets actually inside the viewport.
 */
export const sheetDef = defineNode({
  type: "sheet",
  view: SheetView,
  drawPlaceholder: drawSheetPlaceholder,
  lod: { minZoomForReact: 0.25, minZoomForPlaceholder: 0.05 },
  hitTest: (node, p) => p.x >= 0 && p.x <= node.w && p.y >= 0 && p.y <= node.h,
})
