/**
 * openBoard (A2) — wire a persisted board into a live canvas store.
 *
 * Loads the board's content (snapshot + oplog), hydrates a fresh store, and
 * attaches persistence so future edits are saved. Each open mints a NEW random
 * clientId (the canvas-harness default): batch ids are `clientId + counter`, so
 * reusing a clientId across loads would collide ids and trip dedupe — a rule the
 * A1 fuzz surfaced.
 */
import { createCanvasStore } from "@canvas-harness/core"
import type { CanvasStore } from "@canvas-harness/core"
import { getLocalStores } from "@/features/local-stores"
import { BoardPersistence } from "./board-persistence"
import type { BoardPersistenceOptions } from "./board-persistence"
import { contentToScene } from "./codec"


export type OpenBoardHandle = {
  store: CanvasStore
  persistence: BoardPersistence
  /** Flush pending writes, detach persistence, and close the connection. */
  close: () => Promise<void>
}


/** Open a board for editing, hydrating from local storage and wiring persistence. */
export const openBoard = async (
  boardId: string,
  opts: BoardPersistenceOptions = {},
): Promise<OpenBoardHandle> => {
  // Default to the app-wide shared engine; tests may inject their own.
  const engine = opts.engine ?? (await getLocalStores()).engine
  const persistence = new BoardPersistence(boardId, { ...opts, engine })
  await persistence.init()
  const content = await persistence.load()
  // No clientId passed → fresh random id per load (see note above).
  const store = createCanvasStore({ initial: contentToScene(content) })
  const detach = persistence.attach(store)

  const close = async (): Promise<void> => {
    detach()
    await persistence.flush()
    persistence.close()
  }

  return { store, persistence, close }
}
