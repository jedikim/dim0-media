/**
 * Ingest a parsed document into a board's local store (F2 B6).
 *
 * Chunk the OCR'd markdown, persist it as a document + chunks, and refresh the
 * board's search index so `doc_search` sees it immediately. Titles are unique
 * per board (enforced at the UI): a same-title upload REUSES the existing
 * document's id (override in place) so citations in earlier answers stay valid.
 * The `docId` is the stable internal handle; the title is the human/model label.
 */
import { generateUuid } from "@/lib/common"
import { getLocalStores } from "@/features/local-stores"
import { refreshDocIndex } from "@/features/board/search/use-doc-index"
import { chunkMarkdown } from "@/features/agent/engine/doc-chunk"


export type IngestResult = { docId: string | null; chunks: number; replaced: boolean }


/**
 * Persist a parsed document (markdown → chunks) on a board and reindex it.
 * Returns the (possibly reused) doc id, the chunk count, and whether it replaced
 * a same-title document.
 */
export const ingestDocument = async (opts: {
  boardId: string
  title: string
  markdown: string
  pages: number
}): Promise<IngestResult> => {
  const { docs } = await getLocalStores()
  const existing = await docs.findByTitle(opts.boardId, opts.title)
  const docId = existing?.id ?? generateUuid()

  const chunkRecords = chunkMarkdown(opts.markdown).map((c) => ({
    chunkId: `${docId}#${c.index}`,
    docId,
    boardId: opts.boardId,
    index: c.index,
    text: c.text,
  }))

  // An unreadable PDF (no OCR text → no chunks) must NOT persist: it would save
  // an empty document and, on a same-name re-upload, replaceDocument would wipe
  // the existing good version's chunks. Leave any existing doc untouched.
  if (chunkRecords.length === 0) {
    return { docId: null, chunks: 0, replaced: false }
  }

  await docs.replaceDocument(
    { id: docId, boardId: opts.boardId, title: opts.title, pages: opts.pages, createdAt: Date.now() },
    chunkRecords,
  )
  await refreshDocIndex(opts.boardId)

  return { docId, chunks: chunkRecords.length, replaced: existing !== undefined }
}
