import { useEffect, useRef, useState } from "react"
import type { CanvasStore } from "@canvas-harness/core"
import { diffSnapshots, type Snapshot } from "./diff-snapshots"
import { flushApiCalls } from "./flush-api-calls"


export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error"


export type UseBoardDebouncedSaveOptions = {
  /** Idle delay between the last commit and the next flush. Default 500ms. */
  debounceMs?: number
}


/**
 * `lastSavedRef`'s payload is tagged with the boardId it was captured
 * from. Diffs only run when the tag matches the effect's current
 * boardId — a guard against a rebase from a previous board's effect
 * leaking into a flush queued by a later effect (see Fix 3 in the
 * board-switch-race investigation).
 */
type LastSaved = { snapshot: Snapshot; boardId: string }


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
 *
 * **Board-switch safety.** The cleanup clears any pending debounce
 * timer so a flush queued before navigation can't fire afterward, and
 * `lastSavedRef` carries the boardId it represents — `flush()` refuses
 * to compute a diff against a baseline from a different board, even
 * if the closure's `boardId` somehow disagrees with the current
 * baseline (defense in depth).
 */
export const useBoardDebouncedSave = (
  store: CanvasStore,
  boardId: string | null,
  ready: boolean,
  options: UseBoardDebouncedSaveOptions = {},
): SaveStatus => {
  const debounceMs = options.debounceMs ?? 500
  const [status, setStatus] = useState<SaveStatus>("idle")
  const lastSavedRef = useRef<LastSaved | null>(null)

  useEffect(() => {
    if (!boardId || !ready) return
    let timer: ReturnType<typeof setTimeout> | null = null

    // Re-baseline once hydration declares the scene in sync with the
    // server. The boardId tag pins this baseline to the right board.
    lastSavedRef.current = {
      snapshot: {
        nodes: store.getAllNodes(),
        edges: store.getAllEdges(),
      },
      boardId,
    }
    setStatus("idle")

    const flush = async (): Promise<void> => {
      timer = null
      const current = lastSavedRef.current
      // A baseline from a different board is the smoking gun for the
      // content-swap bug — bail before computing a poisoned diff.
      if (!current || current.boardId !== boardId) {
        setStatus("idle")
        return
      }
      const next: Snapshot = {
        nodes: store.getAllNodes(),
        edges: store.getAllEdges(),
      }
      const calls = diffSnapshots(current.snapshot, next)
      if (calls.length === 0) {
        setStatus("idle")
        return
      }
      setStatus("saving")
      try {
        await flushApiCalls(calls, boardId)
        // Re-check before committing the new baseline — a board switch
        // could have happened during the await.
        if (lastSavedRef.current?.boardId === boardId) {
          lastSavedRef.current = { snapshot: next, boardId }
        }
        setStatus("saved")
      } catch (err) {
        console.error("[harness/persist] flush failed", err)
        setStatus("error")
      }
    }

    const unsubscribe = store.subscribe("change", (batch) => {
      // Remote-origin batches (AI/agent applies) are already on the
      // server — folding them into lastSaved prevents the next flush
      // from re-uploading the same data while still keeping the
      // baseline in sync for any later local edits.
      if (batch.origin === "remote") {
        lastSavedRef.current = {
          snapshot: {
            nodes: store.getAllNodes(),
            edges: store.getAllEdges(),
          },
          boardId,
        }
        return
      }
      if (timer === null) setStatus("pending")
      else clearTimeout(timer)
      timer = setTimeout(() => { void flush() }, debounceMs)
    })

    return () => {
      // Clear any pending debounce so a flush queued before a board
      // switch can't fire after the switch with a stale closure.
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      unsubscribe()
    }
  }, [store, boardId, ready, debounceMs])

  return status
}
