import { defineNode } from "@canvas-harness/core"
import { drawDocumentPlaceholder } from "./placeholder"
import { DocumentView } from "./view"


/**
 * Document node — uploaded file (PDF / text / etc.). canvas-harness
 * node.type is overridden from `note.style.type` to `"document"` in the
 * convert layer (see note-to-node.ts), so this def picks up everything
 * with `note.type === "document"`.
 */
export const documentDef = defineNode({
  type: "document",
  view: DocumentView,
  drawPlaceholder: drawDocumentPlaceholder,
  lod: { minZoomForReact: 0.4, minZoomForPlaceholder: 0.05 },
  hitTest: (node, p) => p.x >= 0 && p.x <= node.w && p.y >= 0 && p.y <= node.h,
})
