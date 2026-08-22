import { useEffect, useState } from "react"
import type { CanvasStore, Edge, EdgeEnd, EdgeId, NodeId } from "@canvas-harness/core"


export const IMAGE_REFERENCE_EDGE_MARKER = "image-generator-reference"


const lockedReferenceTargets = new Map<string, number>()


export type ImageReferenceEdgeData = {
  imageReference?: true
  imageReferenceOrdinal?: number
  createdAt?: string
}


export type OrderedImageReference = {
  edge: Edge
  sourceNodeId: NodeId
  ordinal: number
}


/** Return whether this client currently locks reference authoring for a target. */
export function isImageReferenceTargetLocked(targetNodeId: NodeId): boolean {
  return (lockedReferenceTargets.get(String(targetNodeId)) ?? 0) > 0
}


/** Keep local reference additions disabled while one generator's inputs are locked. */
export function useImageReferenceTargetLock(targetNodeId: NodeId, locked: boolean): void {
  useEffect(() => {
    if (!locked) return
    const key = String(targetNodeId)
    lockedReferenceTargets.set(key, (lockedReferenceTargets.get(key) ?? 0) + 1)
    return () => {
      const remaining = (lockedReferenceTargets.get(key) ?? 1) - 1
      if (remaining > 0) lockedReferenceTargets.set(key, remaining)
      else lockedReferenceTargets.delete(key)
    }
  }, [locked, targetNodeId])
}


/** Return the node ID from an attached endpoint, excluding free endpoints. */
export function attachedNodeId(end: EdgeEnd): NodeId | null {
  return "nodeId" in end ? end.nodeId : null
}


/** Read a valid persisted reference ordinal from edge data. */
export function readImageReferenceOrdinal(data: unknown): number | null {
  const value = (data as ImageReferenceEdgeData | null)?.imageReferenceOrdinal
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null
}


/** Return ordered marked references targeting one Image Generator node. */
export function orderedImageReferences(
  store: CanvasStore,
  targetNodeId: NodeId,
): OrderedImageReference[] {
  const references: OrderedImageReference[] = []
  for (const edge of store.getAllEdges()) {
    const data = (edge.data ?? {}) as ImageReferenceEdgeData
    if (data.imageReference !== true) continue
    const sourceNodeId = attachedNodeId(edge.source)
    const target = attachedNodeId(edge.target)
    const ordinal = readImageReferenceOrdinal(data)
    if (!sourceNodeId || target !== targetNodeId || ordinal === null) continue
    references.push({ edge, sourceNodeId, ordinal })
  }
  return references.sort((left, right) => {
    if (left.ordinal !== right.ordinal) return left.ordinal - right.ordinal
    const leftCreated = ((left.edge.data ?? {}) as ImageReferenceEdgeData).createdAt ?? ""
    const rightCreated = ((right.edge.data ?? {}) as ImageReferenceEdgeData).createdAt ?? ""
    const createdOrder = leftCreated.localeCompare(rightCreated)
    if (createdOrder !== 0) return createdOrder
    return String(left.edge.id).localeCompare(String(right.edge.id))
  })
}


/** Return the next append-only ordinal for one generator's reference edges. */
export function nextImageReferenceOrdinal(
  store: CanvasStore,
  targetNodeId: NodeId,
  excludeEdgeId?: EdgeId,
): number {
  const ordinals = orderedImageReferences(store, targetNodeId)
    .filter((reference) => reference.edge.id !== excludeEdgeId)
    .map((reference) => reference.ordinal)
  return ordinals.length === 0 ? 0 : Math.max(...ordinals) + 1
}


/** Subscribe to the ordered reference-edge source of truth for one target. */
export function useOrderedImageReferences(
  store: CanvasStore,
  targetNodeId: NodeId,
): OrderedImageReference[] {
  const [references, setReferences] = useState(() => orderedImageReferences(store, targetNodeId))
  useEffect(() => store.subscribe("change", (batch) => {
    if (!batch.ops.some((op) => (
      op.type === "edge.add"
      || op.type === "edge.update"
      || op.type === "edge.remove"
    ))) return
    const next = orderedImageReferences(store, targetNodeId)
    setReferences((current) => {
      const currentSignature = current.map(({ edge, sourceNodeId, ordinal }) => `${edge.id}:${sourceNodeId}:${ordinal}`).join("|")
      const nextSignature = next.map(({ edge, sourceNodeId, ordinal }) => `${edge.id}:${sourceNodeId}:${ordinal}`).join("|")
      return currentSignature === nextSignature ? current : next
    })
  }), [store, targetNodeId])
  return references
}
