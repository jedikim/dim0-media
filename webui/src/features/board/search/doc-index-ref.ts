import type { DocChunkIndex } from "./doc-index"


/**
 * Module-level reference to the active board's document-chunk index. Mirrors
 * `search-index-ref` so code outside the React tree — the agent's `doc_search`
 * tool and the answer's document Sources view (B7) — can reach the live index
 * without prop-drilling.
 *
 * Registered by `useLocalDocIndex` on a local board mount, rebuilt after an
 * upload, cleared on unmount. One board is active at a time, so a single slot
 * suffices; callers must handle `null` (nothing mounted → no documents).
 */
let _index: DocChunkIndex | null = null


export const setDocIndexRef = (index: DocChunkIndex | null): void => {
  _index = index
}


export const getDocIndexRef = (): DocChunkIndex | null => _index
