import { useEffect, useState } from "react"
import type { Node, NodeId } from "@canvas-harness/core"
import { getCanvasStoreRef } from "../canvas-store-ref"


/**
 * Read a single harness Node by id from outside the `<CanvasProvider>`
 * tree (e.g. sidebar chrome at the app shell level). Subscribes to the
 * module-level store ref the canvas mounts via `setCanvasStoreRef`,
 * so it stays reactive across board switches + node mutations.
 *
 * Returns `null` when there's no active canvas (e.g. user is on
 * `/boards` index) OR the id doesn't match any current node.
 */
export const useHarnessNodeExternal = (id: string | undefined): Node | null => {
  const [node, setNode] = useState<Node | null>(() => {
    if (!id) return null
    const store = getCanvasStoreRef()
    return store?.getNode(id as NodeId) ?? null
  })

  useEffect(() => {
    if (!id) {
      setNode(null)
      return
    }
    const read = (): Node | null => {
      const store = getCanvasStoreRef()
      return store?.getNode(id as NodeId) ?? null
    }
    setNode(read())
    // The store ref itself can swap (board scope change). We can't
    // subscribe to "ref change" cheaply — fall back to a microtask
    // re-read so a freshly-mounted board picks the node up. Once
    // attached, the change subscription handles all subsequent updates.
    const store = getCanvasStoreRef()
    if (!store) {
      const id2 = window.setTimeout(() => setNode(read()), 0)
      return () => window.clearTimeout(id2)
    }
    return store.subscribe("change", () => setNode(read()))
  }, [id])

  return node
}
