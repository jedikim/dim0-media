import { generateUuid } from "@/lib/common"
import { createDefaultLinkStyle, type LinkStyle } from "./style"
import type { RichText } from "./note"


/**
 * Interface for properties of a link.
 */
export interface LinkProperties {
  edgeControlPoint: {
    type: "position",
    position?: { x: number; y: number }
  }
  startPoint?: {
    type: "position",
    position?: { x: number; y: number }
    /**
     * When the link's source resolves to an attached node, `position`
     * is interpreted as a node-local offset (relative to the node's
     * top-left, pre-rotation) instead of an absolute world coord.
     * Defaults to false for back-compat with rows persisted before
     * this flag existed. See backend `PositionProperty.is_local_offset`.
     */
    isLocalOffset?: boolean
  }
  endPoint?: {
    type: "position",
    position?: { x: number; y: number }
    /** Mirrors `startPoint.isLocalOffset` for the target endpoint. */
    isLocalOffset?: boolean
  }
}

export const createDefaultLinkProperties = (): LinkProperties => ({
  edgeControlPoint: {
    type: "position"
  }
})


/**
 * Interface for a link between nodes in the board.
 */
export interface Link extends Record<string, unknown> {
  id: string
  type: "link"
  version: number

  properties: LinkProperties

  source: string
  target: string
  label?: RichText
  style: LinkStyle

  createdAt: string
  updatedAt?: string
  deletedAt?: string

  graphUid: string
  parentId?: string
}


/**
 * Function to create a default link.
 *
 * @param boardId - The ID of the board to which the link belongs.
 * @param source - The ID of the source node.
 * @param target - The ID of the target node.
 * @returns A new link with default properties.
 */
export const createDefaultLink = (
  boardId: string,
  source: string,
  target: string,
  parentId?: string,
): Link => ({
  id: generateUuid(),
  type: "link",
  version: 1,
  properties: createDefaultLinkProperties(),
  source,
  target,
  style: createDefaultLinkStyle(),
  createdAt: new Date().toISOString(),
  graphUid: boardId,
  parentId,
})
