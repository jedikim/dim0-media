/**
 * Referential integrity for the scene graph.
 *
 * Used by both live sync (the coordinator, after applying a remote batch) and
 * reload (materialize), so a board converges the same way whether it stayed open
 * or was reloaded.
 */
import { asBatchId } from "@canvas-harness/core"
import type { CanvasStore, EdgeEnd, NodeId } from "@canvas-harness/core"


/** The node an edge end is attached to, or undefined if it floats in world space. */
const endNodeId = (end: EdgeEnd): NodeId | undefined => ("nodeId" in end ? end.nodeId : undefined)


/**
 * Drop edges whose source or target node no longer exists. This happens when one
 * client deletes a node while another concurrently adds an edge to it: the edge
 * lands after the delete and dangles. Applied as a `remote` batch so the removal
 * is neither echoed to the relay nor re-persisted — every replica prunes
 * independently and converges. Returns the number of edges pruned. Floating
 * (world-anchored) ends are never dangling — they aren't tied to a node.
 */
export const pruneDanglingEdges = (store: CanvasStore): number => {
  const nodeIds = new Set(store.getAllNodes().map((n) => n.id))
  const missing = (end: EdgeEnd): boolean => {
    const id = endNodeId(end)
    return id !== undefined && !nodeIds.has(id)
  }
  const dangling = store.getAllEdges().filter((e) => missing(e.source) || missing(e.target))
  if (dangling.length === 0) return 0
  store.applyBatch({
    id: asBatchId(`prune:${dangling.map((e) => e.id).join(",")}`),
    clientId: store.clientId,
    ts: 0,
    origin: "remote",
    ops: dangling.map((edge) => ({ type: "edge.remove", edge })),
  })
  return dangling.length
}
