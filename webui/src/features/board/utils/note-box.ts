import type { NodeType } from '../types/style'
import { getShapeContentScale } from './shape-content-scale'


/**
 * Single source of truth for the padding/scale math that maps between a node's
 * outer box (what React Flow sizes) and its inner content box (what the markdown
 * renderer paints into). Keep all callers — Shape, min-height hook, mindmap
 * pre-sizer — routed through these helpers so they cannot drift apart.
 */


type NodePadding = {
  outer: number
  horizontal: number
  vertical: number
  descenderAllowance: number
}


const getNodePadding = (nodeType: NodeType): NodePadding => {
  const isText = nodeType === 'text'
  return {
    outer: isText ? 0 : 8,
    horizontal: isText ? 0 : 16,
    vertical: 16,
    descenderAllowance: 4,
  }
}


/**
 * Effective content scale for a node type, clamped to <= 1 so we never expand
 * the inner box past the node box (matches the existing Shape behavior).
 */
export const getEffectiveContentScale = (nodeType: NodeType): number =>
  Math.min(1, getShapeContentScale(nodeType))


/**
 * Node types whose visible content is markdown text rendered through Shape's
 * TextNodeView path — these are the only nodes that should have a content-
 * driven min-height. Everything else (sheets, folders, code sandboxes, widgets,
 * images, icons, slides) renders custom UI with its own intrinsic sizing rules
 * and should not be clamped against an estimated text height.
 */
export const nodeUsesContentMinHeight = (nodeType: NodeType): boolean => {
  switch (nodeType) {
    case 'sheet':
    case 'slide':
    case 'folder':
    case 'image':
    case 'icon':
    case 'code-sandbox':
    case 'widget':
      return false
    default:
      return true
  }
}


export type ContentBox = {
  width: number
  height: number
}


/**
 * Maps the node outer dimensions to the inner content box used by the renderer.
 * Mirrors the Shape layout exactly so estimator results line up with what the
 * canvas/DOM markdown sees at paint time.
 */
export const contentBoxFromNode = ({
  nodeType,
  nodeWidth,
  nodeHeight,
}: {
  nodeType: NodeType
  nodeWidth: number
  nodeHeight: number
}): ContentBox => {
  const scale = getEffectiveContentScale(nodeType)
  const padding = getNodePadding(nodeType)
  const scaledW = Math.floor(nodeWidth * scale)
  const scaledH = Math.floor(nodeHeight * scale)
  return {
    width: Math.max(1, scaledW - padding.outer - padding.horizontal),
    height: Math.max(1, scaledH - padding.outer - padding.vertical + padding.descenderAllowance),
  }
}


/**
 * Inverse of contentBoxFromNode for height: given a measured/estimated content
 * height, returns the minimum node outer height that can hold it without clipping.
 */
export const nodeHeightFromContent = ({
  nodeType,
  contentHeight,
}: {
  nodeType: NodeType
  contentHeight: number
}): number => {
  const scale = getEffectiveContentScale(nodeType)
  const padding = getNodePadding(nodeType)
  const outerScaled = contentHeight + padding.outer + padding.vertical - padding.descenderAllowance
  return Math.ceil(outerScaled / scale)
}


/**
 * Width-only inverse helper for callers that need the inner content width given
 * a node width (e.g. estimator inputs).
 */
export const contentWidthFromNode = ({
  nodeType,
  nodeWidth,
}: {
  nodeType: NodeType
  nodeWidth: number
}): number => {
  const scale = getEffectiveContentScale(nodeType)
  const padding = getNodePadding(nodeType)
  return Math.max(1, Math.floor(nodeWidth * scale) - padding.outer - padding.horizontal)
}
