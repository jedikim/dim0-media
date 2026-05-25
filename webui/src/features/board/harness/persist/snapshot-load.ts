import type { CanvasStore, Node } from "@canvas-harness/core"
import { getBoard } from "@/features/board/api/get-board"
import type { Graph } from "@/features/board/types/board"
import { linkToEdge } from "../convert/link-to-edge"
import { noteToNode } from "../convert/note-to-node"


export type HydrateResult = {
  graph: Graph
  canEdit: boolean
}


/**
 * Fetch a board from the API and load its nodes / edges into the
 * canvas-harness store. Wrapped in one batch (so the initial paint
 * doesn't trigger N renders) and the history stack is cleared after
 * — first-load is never undoable.
 *
 * Returns the raw graph metadata (label, visibility, canEdit) for the
 * caller to push into the board-app store.
 */
export const hydrateBoardStore = async (
  store: CanvasStore,
  opts: { boardId: string; rootId?: string },
): Promise<HydrateResult> => {
  const { boardId, rootId } = opts
  const { graph, canEdit } = await getBoard(boardId, rootId)
  const notes = graph.nodes ?? []
  const links = graph.edges ?? []

  const nodes = notes.map(noteToNode)
  const nodesById = new Map<string, Node>(
    nodes.map((n) => [n.id as unknown as string, n]),
  )
  const edges = links.map((l) => linkToEdge(l, nodesById))

  // Clear any prior scene (scope changes need a clean slate) then load fresh.
  // Subscribers (incl. the debounced save) should be gated on a `ready` flag
  // so these ops don't generate spurious REST calls — see use-debounced-save.
  store.batch(() => {
    for (const e of store.getAllEdges()) store.removeEdge(e.id)
    for (const n of store.getAllNodes()) store.removeNode(n.id)
    for (const n of nodes) store.addNode(n)
    for (const e of edges) store.addEdge(e)
  })
  store.clearHistory()

  return { graph, canEdit }
}
