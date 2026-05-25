import { defineNode } from "@canvas-harness/core"
import { drawFolderPlaceholder } from "./placeholder"
import { FolderView } from "./view"


/**
 * Folder node — nested-board entry point. Phase 4 wires double-click on
 * a folder node to router navigation; the view here only renders the
 * card. The placeholder paints at low zoom (≤ minZoomForReact).
 *
 * `view` is truthy → the renderer adds this node's id to its overlay
 * set whenever camera.z ≥ minZoomForReact and the node isn't moving.
 * The actual React mount goes through `<Canvas renderCustomNodeView>`
 * (which dispatches to VIEW_REGISTRY in render-view.tsx).
 */
export const folderDef = defineNode({
  type: "folder",
  view: FolderView,
  drawPlaceholder: drawFolderPlaceholder,
  lod: { minZoomForReact: 0.4, minZoomForPlaceholder: 0.05 },
  hitTest: (node, p) => p.x >= 0 && p.x <= node.w && p.y >= 0 && p.y <= node.h,
})
