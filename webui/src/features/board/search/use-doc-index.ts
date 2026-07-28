import { useEffect, useRef } from "react"
import { getLocalStores } from "@/features/local-stores"
import { DocChunkIndex } from "./doc-index"
import { getDocIndexRef, setDocIndexRef } from "./doc-index-ref"


/**
 * Rebuild a doc-chunk index from a board's persisted documents + chunks, joining
 * each chunk to its document title (for citations). Extracted so it's testable
 * without React and reusable by both the mount hook and the post-upload refresh.
 */
export const rebuildDocIndex = async (index: DocChunkIndex, boardId: string): Promise<void> => {
  const { docs } = await getLocalStores()
  const [documents, chunks] = await Promise.all([
    docs.listDocuments(boardId),
    docs.chunksForBoard(boardId),
  ])
  const titleById = new Map(documents.map((d) => [d.id, d.title]))
  await index.rebuild(
    chunks.map((c) => ({
      chunkId: c.chunkId,
      docId: c.docId,
      docTitle: titleById.get(c.docId) ?? "",
      text: c.text,
    })),
  )
}


/** Rebuild the ACTIVE board's doc index (call after an upload). No-op if none is mounted. */
export const refreshDocIndex = async (boardId: string): Promise<void> => {
  const index = getDocIndexRef()
  if (index) await rebuildDocIndex(index, boardId)
}


/**
 * Own the local board's document-chunk index: create it once, build it from the
 * board's persisted chunks on mount, publish it on the module ref (so
 * `doc_search` + the sources view can reach it), and clear the ref on unmount.
 * `enabled` gates it to local boards.
 */
export const useLocalDocIndex = (boardId: string, enabled: boolean): void => {
  const ref = useRef<DocChunkIndex | null>(null)

  useEffect(() => {
    if (!enabled || !boardId) return
    const index = ref.current ?? new DocChunkIndex()
    ref.current = index
    setDocIndexRef(index)
    void rebuildDocIndex(index, boardId).catch(() => undefined)
    return () => setDocIndexRef(null)
  }, [boardId, enabled])
}
