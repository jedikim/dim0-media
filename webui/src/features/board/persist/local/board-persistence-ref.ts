import type { BoardPersistence } from "./board-persistence"


/**
 * Module ref to the active local board's persistence. Mirrors `canvas-store-ref`
 * so code outside the harness (e.g. descendant-cascade delete) can reach the
 * whole-board oplog without prop-drilling.
 *
 * Set by HarnessCanvas on a local board mount, cleared on unmount / scope change.
 * `null` on backend boards (they have no local persistence) — callers must handle
 * that (e.g. delete falls back to store-only + server-side cascade).
 */
let _persistence: BoardPersistence | null = null


export const setBoardPersistenceRef = (p: BoardPersistence | null): void => {
  _persistence = p
}


export const getBoardPersistenceRef = (): BoardPersistence | null => _persistence
