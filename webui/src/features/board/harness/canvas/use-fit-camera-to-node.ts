import type { CameraState, CanvasStore, Node } from "@canvas-harness/core"


/**
 * Default padding fraction around the fitted node — 5% on each side.
 * Matches the rough feel of react-flow's `fitView({ padding: 0.1 })`.
 */
const DEFAULT_PAD = 0.05


/**
 * Compute a `CameraState` that fills the viewport with the given node's
 * world rect, centered, with `pad` fractional padding on each side.
 *
 * Camera math (see `canvas-harness/packages/core/src/camera`):
 *   worldToScreen(world, c) = (world - c.{x,y}) * c.z
 * We want the node's world-center to land at the viewport center, so:
 *   c.x = nodeCenterX - viewportW / (2 * c.z)
 *   c.y = nodeCenterY - viewportH / (2 * c.z)
 */
export const cameraFitNode = (
  node: Node,
  viewportW: number,
  viewportH: number,
  pad = DEFAULT_PAD,
): CameraState => {
  const padded = 1 + pad * 2
  const z = Math.min(viewportW / (node.w * padded), viewportH / (node.h * padded))
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  return {
    x: cx - viewportW / (2 * z),
    y: cy - viewportH / (2 * z),
    z,
  }
}


/**
 * Snap the store's camera so the given node fills the viewport. No
 * animation — `setCamera` is a single state write, the renderer redraws
 * on the next frame.
 *
 * Returns `false` if the wrap element isn't measurable yet (zero-sized
 * during early mount) so callers can retry.
 */
export const fitCameraToNode = (
  store: CanvasStore,
  wrap: HTMLElement | null,
  node: Node,
  pad?: number,
): boolean => {
  if (!wrap) return false
  const rect = wrap.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return false
  store.setCamera(cameraFitNode(node, rect.width, rect.height, pad))
  return true
}
