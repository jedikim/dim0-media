import { useEffect, useState } from "react"
import type { CanvasStore } from "@canvas-harness/core"


/**
 * Live count of nodes of a given type on the board. Subscribes to store
 * `change` events so per-board limit badges/counters stay current.
 *
 * Mirrors `useDocumentLikeNodes`'s `useState + change-subscriber` pattern:
 * `getAllNodes()` returns a fresh array each call, so `useSyncExternalStore`
 * would loop on the unstable snapshot.
 */
export const useNodeTypeCount = (store: CanvasStore, type: string): number => {
  const read = (): number => store.getAllNodes().filter((n) => n.type === type).length
  const [count, setCount] = useState<number>(read)
  useEffect(() => {
    setCount(read())
    return store.subscribe("change", () => setCount(read()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, type])
  return count
}
