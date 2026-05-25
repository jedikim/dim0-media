import { useEffect, useRef, useState } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import { diffSnapshots, EMPTY_SNAPSHOT, type Snapshot } from "./diff-snapshots"
import { flushApiCalls } from "./flush-api-calls"


export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error"


export type UseBoardDebouncedSaveOptions = {
  /** Idle delay between the last commit and the next flush. Default 500ms. */
  debounceMs?: number
}


/**
 * Subscribe to canvas-store commits and persist them via the existing
 * board REST API. Captures a snapshot per flush, diffs against the
 * last-saved snapshot, and issues only the minimal set of REST calls.
 *
 * Undo / redo participate automatically — the lib re-emits `'change'`
 * with `origin: 'history'`, the timer re-arms, the next flush sees
 * the post-undo scene and writes the inverse calls.
 *
 * **Remote-origin batches** (agent writes via `store.applyBatch` with
 * `origin: 'remote'`) are skipped: the backend already has them, so
 * re-persisting would round-trip the same data. We rebaseline
 * `lastSavedRef` on remote batches so a subsequent local edit's diff
 * doesn't treat the remote-applied state as "needs upload."
 *
 * `ready` gates subscription: the caller flips it true once hydration
 * has populated the store, so the load-time ops don't generate
 * spurious POSTs. Re-baseline happens on the same transition.
 *
 * Pass `boardId = null` (e.g. during route transitions) to suspend
 * saving without unmounting the host.
 */
export const useBoardDebouncedSave = (
  store: CanvasStore,
  boardId: string | null,
  ready: boolean,
  options: UseBoardDebouncedSaveOptions = {},
): SaveStatus => {
  const debounceMs = options.debounceMs ?? 500
  const [status, setStatus] = useState<SaveStatus>("idle")
  const lastSavedRef = useRef<Snapshot>(EMPTY_SNAPSHOT)

  useEffect(() => {
    if (!boardId || !ready) return
    let timer: ReturnType<typeof setTimeout> | null = null

    // Re-baseline once hydration declares the scene in sync with the server.
    lastSavedRef.current = {
      nodes: store.getAllNodes(),
      edges: store.getAllEdges(),
    }
    setStatus("idle")

    const flush = async (): Promise<void> => {
      timer = null
      const next: Snapshot = {
        nodes: store.getAllNodes(),
        edges: store.getAllEdges(),
      }
      const calls = diffSnapshots(lastSavedRef.current, next)
      if (calls.length === 0) {
        setStatus("idle")
        return
      }
      setStatus("saving")
      try {
        await flushApiCalls(calls, boardId)
        lastSavedRef.current = next
        setStatus("saved")
      } catch (err) {
        console.error("[harness/persist] flush failed", err)
        setStatus("error")
      }
    }

    return store.subscribe("change", (batch) => {
      // Remote-origin batches (AI/agent applies) are already on the
      // server — folding them into lastSaved prevents the next flush
      // from re-uploading the same data while still keeping the
      // baseline in sync for any later local edits.
      if (batch.origin === "remote") {
        lastSavedRef.current = {
          nodes: store.getAllNodes(),
          edges: store.getAllEdges(),
        }
        return
      }
      if (timer === null) setStatus("pending")
      else clearTimeout(timer)
      timer = setTimeout(() => { void flush() }, debounceMs)
    })
  }, [store, boardId, ready, debounceMs])

  return status
}
