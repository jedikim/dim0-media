import { defineNode } from "@canvas-harness/core"

import { drawGeneratedImagePlaceholder } from "./placeholder"
import { GeneratedImageView } from "./view"


/** Immutable server-generated raster projected as a first-party canvas node. */
export const generatedImageDef = defineNode({
  type: "generated-image",
  view: GeneratedImageView,
  drawPlaceholder: drawGeneratedImagePlaceholder,
  lod: { minZoomForReact: 0.4, minZoomForPlaceholder: 0.05 },
  hitTest: (node, point) =>
    point.x >= 0 && point.x <= node.w && point.y >= 0 && point.y <= node.h,
})
