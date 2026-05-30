import { asBatchId, type CanvasStore, type Node, type Op } from "@canvas-harness/core"
import { getBoard, type BoardRole } from "@/features/board/api/get-board"
import type { Graph } from "@/features/board/types/board"
import { linkToEdge } from "../convert/link-to-edge"
import { noteToNode } from "../convert/note-to-node"


export type HydrateResult = {
  graph: Graph
  canEdit: boolean
  role: BoardRole
}


/**
 * Apply a Graph payload (REST-shaped notes / links) to the canvas-harness
 * store. Two modes:
 *
 *   - `"replace"` (default — used by `hydrateBoardStore` on first load):
 *     nuke the store and replay the snapshot. Undo history is cleared
 *     because a fresh hydration is never undoable.
 *   - `"merge"` (used by the WS welcome handler on reconnect /
 *     authoritative sync): diff against current store state and apply
 *     minimal changes. Empty snapshots are a no-op, NOT a wipe — a
 *     server-side DB hiccup that yields `{}` won't blank the canvas.
 *     Undo history is preserved.
 *
 * Hydration is a server-truth replay, not a user edit. We ship the
 * whole thing as ONE `origin: "remote"` batch so the local-batch
 * subscribers stay quiet — most importantly `useStyleMemory` (which
 * would otherwise sponge every hydrated node's style and clobber the
 * user's sticky picks on every board nav) and `attachSync` (which
 * would otherwise re-ship the welcome merge back to the server).
 *
 * The shape conversion (`noteToNode` / `linkToEdge`) is identical in
 * both modes; only the mutation strategy against the existing store
 * differs.
 */
export const applyGraphToStore = (
  store: CanvasStore,
  graph: Graph,
  opts: { mode?: "replace" | "merge" } = {},
): void => {
  const mode = opts.mode ?? "replace"
  const notes = graph.nodes ?? []
  const links = graph.edges ?? []

  const nodes = notes.map(noteToNode)
  const nodesById = new Map<string, Node>(
    nodes.map((n) => [n.id as unknown as string, n]),
  )
  const edges = links.map((l) => linkToEdge(l, nodesById))

  if (mode === "replace") {
    const ops: Op[] = []
    // Edge removes before node removes — `applyOpInternal` for
    // `node.remove` doesn't cascade incident edges (the cascade lives
    // in the imperative `store.removeNode`), so we have to clear edges
    // first to avoid orphan references.
    for (const e of store.getAllEdges()) ops.push({ type: "edge.remove", edge: e })
    for (const n of store.getAllNodes()) ops.push({ type: "node.remove", node: n })
    for (const n of nodes) ops.push({ type: "node.add", node: n })
    for (const e of edges) ops.push({ type: "edge.add", edge: e })
    if (ops.length > 0) {
      store.applyBatch({
        id: asBatchId(store.generateId()),
        clientId: store.clientId,
        ts: Date.now(),
        origin: "remote",
        ops,
      })
    }
    store.clearHistory()
    // Replace mode signals a fresh board scope (the first-load REST
    // path on board navigation). Drop any remote-presence entries
    // accumulated from the previous board so the peer chip / remote
    // cursor overlay don't show stale avatars for peers that aren't
    // actually on the new board's WS room. The subsequent welcome
    // (1c.1) repopulates with the new room's peer set.
    for (const [clientId] of store.presence.getAll()) {
      store.presence.applyRemote(clientId, null)
    }
    return
  }

  // Merge mode: empty input is a no-op. Without this guard, a DB hiccup
  // (where the server returns `{}` from `read_snapshot_payload`) would
  // wipe the entire canvas — the symptom we hit in initial 1c.1 rollout.
  if (nodes.length === 0 && edges.length === 0) return

  const incomingNodeIds = new Set(nodes.map((n) => n.id as unknown as string))
  const incomingEdgeIds = new Set(edges.map((e) => e.id as unknown as string))
  const currentNodes = store.getAllNodes()
  const currentEdges = store.getAllEdges()
  const currentNodeMap = new Map(
    currentNodes.map((n) => [n.id as unknown as string, n]),
  )
  const currentEdgeMap = new Map(
    currentEdges.map((e) => [e.id as unknown as string, e]),
  )

  const ops: Op[] = []
  // Edge removes before node removes (same cascade reasoning as replace).
  for (const e of currentEdges) {
    if (!incomingEdgeIds.has(e.id as unknown as string)) {
      ops.push({ type: "edge.remove", edge: e })
    }
  }
  for (const n of currentNodes) {
    if (!incomingNodeIds.has(n.id as unknown as string)) {
      ops.push({ type: "node.remove", node: n })
    }
  }
  // Add new nodes; update-in-place existing ones so the canvas-harness
  // store's identity-stable refs survive merge (selection / focus stay
  // attached to the same id). `prev: cur` makes the conflict check a
  // field-by-field no-op — hydration is server-truth, never a conflict.
  for (const n of nodes) {
    const id = n.id as unknown as string
    const cur = currentNodeMap.get(id)
    if (cur) {
      ops.push({ type: "node.update", id: n.id, patch: n, prev: cur })
    } else {
      ops.push({ type: "node.add", node: n })
    }
  }
  for (const e of edges) {
    const id = e.id as unknown as string
    const cur = currentEdgeMap.get(id)
    if (cur) {
      ops.push({ type: "edge.update", id: e.id, patch: e, prev: cur })
    } else {
      ops.push({ type: "edge.add", edge: e })
    }
  }
  if (ops.length === 0) return
  store.applyBatch({
    id: asBatchId(store.generateId()),
    clientId: store.clientId,
    ts: Date.now(),
    origin: "remote",
    ops,
  })
  // No clearHistory — merge preserves undo state across reconnects.
}


/**
 * Fetch a board from the API and load its nodes / edges into the
 * canvas-harness store. Wrapped in one batch (so the initial paint
 * doesn't trigger N renders) and the history stack is cleared after
 * — first-load is never undoable.
 *
 * Returns the raw graph metadata (label, visibility, canEdit) for the
 * caller to push into the board-app store.
 *
 * `isCancelled` is checked once after the network resolves: if the
 * caller has navigated to a different scope while the fetch was in
 * flight, we skip the store mutation entirely. Without this guard, the
 * shared store would get clobbered by stale content — and the save
 * loop would then persist the wrong board's nodes/edges back to the
 * current board id.
 */
export const hydrateBoardStore = async (
  store: CanvasStore,
  opts: {
    boardId: string
    rootId?: string
    isCancelled?: () => boolean
  },
): Promise<HydrateResult> => {
  const { boardId, rootId, isCancelled } = opts
  const { graph, canEdit, role } = await getBoard(boardId, rootId)

  // Bail before any conversion or store mutation if a newer scope has
  // taken over. We still return the fetched graph so the caller's
  // (also-cancelled) `.then` doesn't NPE in unusual shapes.
  if (isCancelled?.()) return { graph, canEdit, role }

  applyGraphToStore(store, graph)

  return { graph, canEdit, role }
}
