import type { Edge, EdgeEnd, Node, Vec2 } from "@canvas-harness/core"
import type { Link } from "@/features/board/types/link"
import { applyColorsToEdgeStyle } from "../theme/color-adapter"
import { canvasEdgeStyleToDim0Link } from "./style"
import type { LinkEdgeData } from "./link-to-edge"
import { IMAGE_REFERENCE_EDGE_MARKER, readImageReferenceOrdinal } from "../image-reference-edges"


type FlatEnd = {
  /** Empty string when the endpoint is free-floating (the '' sentinel — see §3.5). */
  nodeId: string
  position?: { x: number; y: number }
  /**
   * True when `position` is a node-local offset (attached endpoint).
   * False when `position` is an absolute world coord (free endpoint).
   * Always set so the wire format is explicit — see backend
   * `PositionProperty.is_local_offset`.
   */
  isLocalOffset: boolean
}


/** Flatten an EdgeEnd into the Link wire format for `start_point`/`end_point`. */
const flattenEnd = (end: EdgeEnd): FlatEnd => {
  if ("nodeId" in end) {
    return {
      nodeId: end.nodeId as unknown as string,
      position: { x: end.localOffset.x, y: end.localOffset.y },
      isLocalOffset: true,
    }
  }
  return {
    nodeId: "",
    position: end.worldPoint,
    isLocalOffset: false,
  }
}


/** Resolve an EdgeEnd to a world-space point — used for midpoint math. */
const endWorldPoint = (end: EdgeEnd, nodes: Map<string, Node>): Vec2 => {
  if ("nodeId" in end) {
    const node = nodes.get(end.nodeId as unknown as string)
    if (node) {
      return { x: node.x + end.localOffset.x, y: node.y + end.localOffset.y }
    }
    // Node missing from the map — fall back to localOffset as world.
    return { x: end.localOffset.x, y: end.localOffset.y }
  }
  return end.worldPoint
}


/**
 * Convert canvas-harness's cubic-bezier control point back to the
 * single midpoint-on-curve that the wire format stores. Inverse of
 * `midpointToCubicControls`: given c1 = c2 = c (the lib's symmetric
 * split), the curve at t = 0.5 passes through
 *   M = (S + T + 6·c) / 8.
 * Returns `undefined` when the edge has no user-set control (the
 * curve is the default tangent-based bezier — nothing to persist).
 */
const cubicControlToMidpoint = (
  source: Vec2,
  target: Vec2,
  control: ReadonlyArray<Vec2> | undefined,
): Vec2 | undefined => {
  if (!control || control.length === 0) return undefined
  const c = control[0]
  return {
    x: (source.x + target.x + 6 * c.x) / 8,
    y: (source.y + target.y + 6 * c.y) / 8,
  }
}


/**
 * Convert a canvas-harness Edge back to a Dim0 Link. Inverse of `linkToEdge`.
 * Always emits the new local-offset wire format for attached endpoints;
 * legacy edges loaded with world coords get upgraded on first save.
 *
 * `nodes` is consulted to resolve attached endpoints to world coords
 * for the cubic→midpoint conversion. Pass the same map you used for
 * loading; for the persist diff path, `nextNodes`.
 */
export const edgeToLink = (edge: Edge, nodes: Map<string, Node>): Link => {
  const data = (edge.data ?? {}) as Partial<LinkEdgeData>
  const sourceFlat = flattenEnd(edge.source)
  const targetFlat = flattenEnd(edge.target)
  const groupIds = edge.groups as unknown as string[]
  const sourceWorld = endWorldPoint(edge.source, nodes)
  const targetWorld = endWorldPoint(edge.target, nodes)
  const midpoint = cubicControlToMidpoint(sourceWorld, targetWorld, edge.control)
  const imageReferenceOrdinal = data.imageReference === true
    ? readImageReferenceOrdinal(data)
    : null

  // Prefer stored colors over the (possibly dark-adapted) display
  // values on `edge.style` so save round-trips the user's pick.
  const storedStyle = data._storedColors
    ? applyColorsToEdgeStyle(edge.style ?? {}, data._storedColors)
    : edge.style

  return {
    id: edge.id as unknown as string,
    type: "link",
    version: data.version ?? 1,
    source: sourceFlat.nodeId,
    target: targetFlat.nodeId,
    label: edge.content ? { markdown: edge.content } : undefined,
    style: canvasEdgeStyleToDim0Link(storedStyle, {
      angle: 0,
      groupIds,
      pathStyle: edge.pathStyle,
    }),
    createdAt: data.createdAt ?? new Date().toISOString(),
    updatedAt: data.updatedAt,
    deletedAt: data.deletedAt,
    graphUid: data.graphUid ?? "",
    parentId: data.parentId,
    properties: {
      edgeControlPoint: midpoint
        ? { type: "position", position: midpoint }
        : { type: "position" },
      startPoint: sourceFlat.position
        ? {
            type: "position",
            position: sourceFlat.position,
            isLocalOffset: sourceFlat.isLocalOffset,
          }
        : undefined,
      endPoint: targetFlat.position
        ? {
            type: "position",
            position: targetFlat.position,
            isLocalOffset: targetFlat.isLocalOffset,
          }
        : undefined,
      imageReference: imageReferenceOrdinal === null
        ? undefined
        : { type: "keyword", value: IMAGE_REFERENCE_EDGE_MARKER },
      imageReferenceOrdinal: imageReferenceOrdinal === null
        ? undefined
        : { type: "number", number: imageReferenceOrdinal },
    },
  }
}
