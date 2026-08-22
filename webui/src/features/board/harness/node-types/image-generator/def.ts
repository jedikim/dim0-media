import { defineNode } from "@canvas-harness/core"

import { drawImageGeneratorPlaceholder } from "./placeholder"
import { ImageGeneratorView } from "./view"


/** First-party on-canvas form for server-side image generation. */
export const imageGeneratorDef = defineNode({
  type: "image-generator",
  view: ImageGeneratorView,
  drawPlaceholder: drawImageGeneratorPlaceholder,
  lod: { minZoomForReact: 0.4, minZoomForPlaceholder: 0.05 },
  hitTest: (node, point) =>
    point.x >= 0 && point.x <= node.w && point.y >= 0 && point.y <= node.h,
})
