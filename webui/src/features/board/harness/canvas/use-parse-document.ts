import { useCallback } from "react"
import {
  type CanvasStore,
  type Edge,
  type Node,
  type Op,
} from "@canvas-harness/core"
import { parseDocument } from "@/features/board/api/parse-document"
import { makeBatch } from "@/features/board/harness/make-batch"
import { linkToEdge } from "../convert/link-to-edge"
import { noteToNode } from "../convert/note-to-node"


/**
 * Result returned by the parse callback so the caller can react
 * (toast success, close dialog, etc.).
 */
export type ParseDocumentResult = {
  nodesAdded: number
  edgesAdded: number
}


/**
 * Apply parsed Notes / Links to the harness store as a single
 * `remote`-origin batch. The backend already wrote the rows when it
 * parsed the PDF; the batch only updates local state, the debounced
 * save loop skips it (same pattern as `apply-tool-output.ts` for AI
 * tool outputs).
 *
 * Filters to the current scope (matching `boardId` / `parentId === rootId`)
 * — if the user navigated to a different board mid-parse, the parsed
 * nodes silently land on the original board's data; they'll show up
 * the next time it's opened.
 */
export const useHarnessParseDocument = (
  store: CanvasStore,
  boardId: string | null,
  rootId: string | null,
) => {
  return useCallback(
    async (file: File): Promise<ParseDocumentResult | null> => {
      if (!boardId) return null
      const { notes, links } = await parseDocument(boardId, file, rootId ?? undefined)

      const scopeRoot = rootId ?? undefined
      const inScopeNotes = notes.filter(
        (n) => n.graphUid === boardId && (n.parentId ?? undefined) === scopeRoot,
      )
      if (inScopeNotes.length === 0) {
        // Backend returned rows for a different scope (user navigated)
        // — nothing to apply locally. Server-side state is still
        // intact; next hydrate will pick it up.
        return { nodesAdded: 0, edgesAdded: 0 }
      }

      const nodes: Node[] = inScopeNotes.map(noteToNode)
      const nodeMap = new Map<string, Node>(
        nodes.map((n) => [n.id as unknown as string, n]),
      )
      const edges: Edge[] = []
      for (const link of links) {
        if (link.graphUid !== boardId) continue
        if ((link.parentId ?? undefined) !== scopeRoot) continue
        edges.push(linkToEdge(link, nodeMap))
      }

      const ops: Op[] = []
      for (const node of nodes) ops.push({ type: "node.add", node })
      for (const edge of edges) ops.push({ type: "edge.add", edge })
      if (ops.length === 0) return { nodesAdded: 0, edgesAdded: 0 }

      store.applyBatch(makeBatch(store, "remote", ops))

      return { nodesAdded: nodes.length, edgesAdded: edges.length }
    },
    [store, boardId, rootId],
  )
}
