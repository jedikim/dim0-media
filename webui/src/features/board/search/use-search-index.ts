import { useEffect, useRef } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import { LocalSearchIndex } from "./local-index"
import { setSearchIndexRef } from "./search-index-ref"


/**
 * Attach a search index to a store and publish it on the module ref. Returns a
 * cleanup that detaches and clears the ref. Extracted from the hook so the
 * lifecycle is testable without React.
 */
export const wireSearchIndex = (store: CanvasStore, index: LocalSearchIndex): (() => void) => {
  setSearchIndexRef(index)
  const detach = index.attach(store)
  return () => {
    detach()
    setSearchIndexRef(null)
  }
}


/**
 * Own the local board's full-text search index: create it once, keep it synced
 * with the live store (it mirrors the current layer via `attach`), and publish it
 * on the module ref so the agent's `search_notes` tool can reach it.
 *
 * Attaches while the store is empty (fresh per mount), so the subsequent hydrate
 * batch and every later edit flow into the index incrementally — no rebuild race.
 * `enabled` gates it to local boards (backend boards use server-side search).
 */
export const useLocalSearchIndex = (store: CanvasStore, enabled: boolean): void => {
  const ref = useRef<LocalSearchIndex | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (!ref.current) ref.current = new LocalSearchIndex()
    return wireSearchIndex(store, ref.current)
  }, [store, enabled])
}
