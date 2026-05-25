import type { Edge, Node } from "@canvas-harness/core"
import type { Link } from "@/features/board/types/link"
import type { Note } from "@/features/board/types/note"
import { edgeToLink } from "../convert/edge-to-link"
import type { LinkEdgeData } from "../convert/link-to-edge"
import { nodeToNote } from "../convert/node-to-note"


/** Snapshot of the canvas-harness scene at a point in time — only the slices we persist. */
export type Snapshot = {
  nodes: ReadonlyArray<Node>
  edges: ReadonlyArray<Edge>
}


/** A REST call queued for the next flush. Each maps 1:1 onto an api/ helper. */
export type ApiCall =
  | { kind: "addNote"; note: Note }
  | { kind: "updateNote"; note: Note }
  | { kind: "removeNote"; noteId: string }
  | { kind: "addLink"; link: Link }
  | { kind: "updateLink"; link: Link }
  | { kind: "removeLink"; linkId: string }


/**
 * Empty snapshot. Use as the initial `lastSaved` when there's no prior
 * server state — the first flush then writes every node and edge in
 * one batch of `addNote` / `addLink` calls.
 */
export const EMPTY_SNAPSHOT: Snapshot = { nodes: [], edges: [] }


// JSON-stringify is good enough for Node/Edge equality — both are plain
// data with no methods, Dates, or Maps in deserialized form.
const sameSerialized = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b)


/** Geometry fields whose changes invalidate a legacy edge's persisted world coord. */
const geometryChanged = (a: Node, b: Node): boolean =>
  a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.angle !== b.angle


/**
 * Diff two snapshots and return the minimal set of REST calls needed
 * to migrate the server from `prev` → `next`. Adds and removes are
 * detected by id-set difference; updates by serialized inequality on
 * matching ids.
 *
 * Also cascades `updateLink` for legacy edges (loaded with world-coord
 * format) whose attached node geometry changed: their persisted world
 * point goes stale otherwise. The cascade resave also upgrades them to
 * the new local-offset format, so it's a one-shot per legacy edge.
 */
export const diffSnapshots = (prev: Snapshot, next: Snapshot): ApiCall[] => {
  const calls: ApiCall[] = []

  const nextNodes = new Map<string, Node>(
    next.nodes.map((n) => [n.id as unknown as string, n]),
  )
  const prevNodes = new Map<string, Node>(
    prev.nodes.map((n) => [n.id as unknown as string, n]),
  )
  const nextEdges = new Map<string, Edge>(
    next.edges.map((e) => [e.id as unknown as string, e]),
  )
  const prevEdges = new Map<string, Edge>(
    prev.edges.map((e) => [e.id as unknown as string, e]),
  )

  for (const [id] of prevEdges) {
    if (!nextEdges.has(id)) calls.push({ kind: "removeLink", linkId: id })
  }
  for (const [id] of prevNodes) {
    if (!nextNodes.has(id)) calls.push({ kind: "removeNote", noteId: id })
  }
  for (const [id, node] of nextNodes) {
    if (!prevNodes.has(id)) calls.push({ kind: "addNote", note: nodeToNote(node) })
  }
  const updatedEdgeIds = new Set<string>()
  for (const [id, edge] of nextEdges) {
    if (!prevEdges.has(id)) {
      calls.push({ kind: "addLink", link: edgeToLink(edge, nextNodes) })
      updatedEdgeIds.add(id)
    }
  }
  const movedNodeIds = new Set<string>()
  for (const [id, nextNode] of nextNodes) {
    const prevNode = prevNodes.get(id)
    if (prevNode && !sameSerialized(prevNode, nextNode)) {
      calls.push({ kind: "updateNote", note: nodeToNote(nextNode) })
      if (geometryChanged(prevNode, nextNode)) movedNodeIds.add(id)
    }
  }
  for (const [id, nextEdge] of nextEdges) {
    const prevEdge = prevEdges.get(id)
    if (prevEdge && !sameSerialized(prevEdge, nextEdge)) {
      calls.push({ kind: "updateLink", link: edgeToLink(nextEdge, nextNodes) })
      updatedEdgeIds.add(id)
    }
  }

  // Cascade: legacy edges (loaded with world-coord positions) keep a
  // marker on `edge.data` per endpoint. When their attached node's
  // geometry changes, the persisted world point goes stale — resave
  // them so they upgrade to the new local-offset format.
  if (movedNodeIds.size > 0) {
    for (const [id, edge] of nextEdges) {
      if (updatedEdgeIds.has(id)) continue
      const data = (edge.data ?? {}) as Partial<LinkEdgeData>
      const sourceNeedsCascade =
        data.sourceLegacyOffset === true &&
        "nodeId" in edge.source &&
        movedNodeIds.has(edge.source.nodeId as unknown as string)
      const targetNeedsCascade =
        data.targetLegacyOffset === true &&
        "nodeId" in edge.target &&
        movedNodeIds.has(edge.target.nodeId as unknown as string)
      if (sourceNeedsCascade || targetNeedsCascade) {
        calls.push({ kind: "updateLink", link: edgeToLink(edge, nextNodes) })
      }
    }
  }

  return calls
}
