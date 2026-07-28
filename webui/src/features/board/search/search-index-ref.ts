import type { LocalSearchIndex } from "./local-index"


/**
 * Module-level reference to the active board's search index. Mirrors
 * `canvas-store-ref` so code outside the React canvas tree (the agent's
 * `search_notes` tool) can reach the live index without prop-drilling.
 *
 * Registered by `useLocalSearchIndex` on a local board mount and cleared on
 * unmount. Only one board is active at a time, so a single slot suffices.
 * Callers must handle `null` (nothing mounted → no index).
 */
let _index: LocalSearchIndex | null = null


export const setSearchIndexRef = (index: LocalSearchIndex | null): void => {
  _index = index
}


export const getSearchIndexRef = (): LocalSearchIndex | null => _index
