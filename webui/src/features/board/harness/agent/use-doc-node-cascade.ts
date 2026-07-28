import { useEffect } from "react"
import type { CanvasStore, OpBatch } from "@canvas-harness/core"
import { getLocalStores } from "@/features/local-stores"
import { refreshDocIndex } from "@/features/board/search/use-doc-index"


/**
 * Doc ids whose `document` node was removed by a GENUINE (non-remote) edit.
 *
 * Admits both `local` and `history` origins: a durable document/folder delete is
 * applied as a non-undoable `history` batch (see DURABLE_DELETE / removeNodeSubtree),
 * and its DocRepo cleanup must still run — a folder delete even carries its child
 * documents' `node.remove` in the same batch.
 *
 * CRITICAL: ignores `origin: "remote"` batches. Hydrate / layer-switch clears the
 * scene as a `remote` batch (see applyContentToStore); without this guard a
 * reload would cascade-delete every document.
 */
export const removedDocNodeIds = (batch: OpBatch): string[] => {
  if (batch.origin === "remote") return []
  const ids: string[] = []
  for (const op of batch.ops) {
    if (op.type === "node.remove" && op.node.type === "document") ids.push(String(op.node.id))
  }
  return ids
}


/**
 * Delete the given documents from local storage and rebuild the board's doc
 * index — so a removed document leaves no orphaned chunks the agent would still
 * search. Shared by the store-change cascade (loaded removals) and the subtree
 * deep-layer sweep (unloaded removals the store never emits a 'change' for).
 */
export const cascadeRemovedDocs = async (boardId: string, docIds: string[]): Promise<void> => {
  if (docIds.length === 0) return
  const { docs } = await getLocalStores()
  for (const id of docIds) await docs.deleteDocument(id)
  await refreshDocIndex(boardId)
}


/**
 * Cascade a document node's deletion to its stored doc + chunks, then reindex —
 * so removing the node from the canvas doesn't leave orphaned chunks the agent
 * would still search. Local boards only. Covers removals the store emits a
 * 'change' for (the loaded layer); deep-layer removals are cascaded directly by
 * `removeNodesSubtreeAsync` (they never reach the store).
 */
export const useDocNodeCascade = (store: CanvasStore, boardId: string, enabled: boolean): void => {
  useEffect(() => {
    if (!enabled || !boardId) return
    return store.subscribe("change", (batch) => {
      void cascadeRemovedDocs(boardId, removedDocNodeIds(batch))
    })
  }, [store, boardId, enabled])
}
