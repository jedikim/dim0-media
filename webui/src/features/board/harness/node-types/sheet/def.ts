import { defineNode } from "@canvas-harness/core"
import { drawSheetPlaceholder } from "./placeholder"
import { SheetView } from "./view"


/**
 * Sheet node — long-form rich-text document (TipTap editor in the
 * modal surface). The inline view shows a title + text preview only;
 * the full editor opens via board-app-store.activeNodeSurface in
 * phase 5.
 */
export const sheetDef = defineNode({
  type: "sheet",
  view: SheetView,
  drawPlaceholder: drawSheetPlaceholder,
  lod: { minZoomForReact: 0.4, minZoomForPlaceholder: 0.05 },
  hitTest: (node, p) => p.x >= 0 && p.x <= node.w && p.y >= 0 && p.y <= node.h,
})
