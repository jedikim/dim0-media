import { useEffect, useState } from "react"
import type { CanvasStore, Node } from "@canvas-harness/core"
import type { NoteNodeData } from "../convert/note-to-node"


/** Node types that read well as a flat list — match prod's filter. */
const DOCUMENT_LIKE: ReadonlySet<string> = new Set([
  "sheet",
  "widget",
  "code-sandbox",
  "document",
  "folder",
])


/** Lift the persisted list order off a Node (defaults to 0). */
export const listOrderOf = (node: Node): number => {
  const data = node.data as Partial<NoteNodeData> | undefined
  return data?.properties?.listOrder?.number ?? 0
}


/**
 * Subscribe to the store's document-like nodes (sheet / widget /
 * code-sandbox / document / folder), sorted by their persisted
 * `listOrder` property. Used by the Files and List views — both
 * read from the same set, share reorder/persist machinery.
 *
 * `useState + change-subscriber` mirrors the lib's `useEdges`
 * pattern: `getAllNodes()` returns a fresh array each call, so a
 * `useSyncExternalStore` here would loop on the unstable snapshot.
 */
export const useDocumentLikeNodes = (store: CanvasStore): Node[] => {
  const read = (): Node[] => {
    const filtered = store
      .getAllNodes()
      .filter((n) => DOCUMENT_LIKE.has(n.type))
    return filtered.sort((a, b) => listOrderOf(a) - listOrderOf(b))
  }
  const [nodes, setNodes] = useState<Node[]>(read)
  useEffect(() => {
    setNodes(read())
    return store.subscribe("change", () => setNodes(read()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])
  return nodes
}
