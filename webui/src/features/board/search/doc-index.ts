/**
 * Per-board document-chunk search index (F2 B5) — a SEPARATE Orama BM25 index
 * over uploaded-document chunks, distinct from the canvas-note index
 * (`local-index.ts`) because docs have a different lifecycle.
 *
 * It's a derived read-model: rebuilt from `DocRepo.chunksForBoard(...)` at board
 * load and after an upload. `text` is the searchable field; `docId`/`docTitle`/
 * the chunk id ride along as stored fields so a hit can be cited back to its
 * source document (chunk → doc). Full-text only — matches the no-RAG decision.
 */
import { count, create, insert, search } from "@orama/orama"


const SCHEMA = { text: "string" } as const


/** A chunk as fed to the index (title joined from its document by the caller). */
export type ChunkDoc = { chunkId: string; docId: string; docTitle: string; text: string }


/** A ranked search hit — the chunk plus the doc it belongs to (for citations). */
export type ChunkHit = ChunkDoc


const asText = (value: unknown): string => (typeof value === "string" ? value : "")


export class DocChunkIndex {
  private db = create({ schema: SCHEMA })


  /** Drop and rebuild from a board's chunks (the derived-model load/refresh path). */
  async rebuild(chunks: ChunkDoc[]): Promise<void> {
    this.db = create({ schema: SCHEMA })
    for (const c of chunks) {
      await insert(this.db, { id: c.chunkId, text: c.text, docId: c.docId, docTitle: c.docTitle })
    }
  }


  /** Ranked full-text query → the top matching chunks with their doc metadata. */
  async query(term: string, limit = 6): Promise<ChunkHit[]> {
    if (!term.trim()) return []
    const res = await search(this.db, { term, limit })
    return res.hits.map((h) => ({
      chunkId: String(h.document.id),
      docId: asText(h.document.docId),
      docTitle: asText(h.document.docTitle),
      text: asText(h.document.text),
    }))
  }


  /** Number of indexed chunks (0 = no docs → the tool isn't offered). */
  count(): number {
    return count(this.db)
  }
}
