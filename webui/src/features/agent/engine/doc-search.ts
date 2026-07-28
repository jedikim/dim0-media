/**
 * The `doc_search` agent tool (F2 B5) — retrieval over the board's uploaded
 * documents, backed by the per-board `DocChunkIndex` (BM25). Offered to the
 * local agent only when a board actually has indexed chunks.
 *
 * Returns the matching passages (for the model to read + answer) plus their
 * `chunkId`/`docId`/`docTitle` so the answer can be cited back to a document
 * (the chunk → doc citation mapping lands in B7).
 */
import { z } from "zod"
import { defineTool, type Tool } from "./types"
import type { DocChunkIndex } from "@/features/board/search/doc-index"


/** Build the `doc_search` tool over a board's document-chunk index. */
export const makeDocSearchTool = (index: DocChunkIndex): Tool =>
  defineTool({
    name: "doc_search",
    description:
      "Search the document(s) uploaded to this board and return matching passages" +
      " to ground and cite the answer. Use this for questions about an uploaded" +
      " document; cite the passages you rely on.",
    parameters: z.object({ query: z.string().describe("What to look up in the documents") }),
    run: async ({ query }) => {
      const results = await index.query(query, 6)
      return { results }
    },
  })
