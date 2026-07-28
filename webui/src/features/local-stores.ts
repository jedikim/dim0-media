/**
 * Composition root for local-first storage.
 *
 * Owns one `StorageEngine` and the repositories composed over it, so the whole
 * app shares a single backing connection — no per-call opens. A desktop build
 * calls `createLocalStores` with a SQLite-backed engine instead; every consumer
 * that goes through `getLocalStores` is then repointed with no other change.
 */
import { IndexedDbEngine } from "@/features/board/persist/local/indexeddb-engine"
import { BoardRegistry } from "@/features/board/persist/local/board-registry"
import type { StorageEngine } from "@/features/board/persist/local/engine"
import { ChatRepo } from "@/features/agent/store/chat-repo"
import { MiniAppRepo } from "@/features/mini-app/mini-app-repo"
import { DocRepo } from "@/features/board/persist/local/doc-repo"


export type LocalStores = {
  engine: StorageEngine
  boards: BoardRegistry
  chats: ChatRepo
  miniApps: MiniAppRepo
  docs: DocRepo
}


/** Compose the repositories over a given engine. Swap the engine for desktop. */
export const createLocalStores = (engine: StorageEngine): LocalStores => ({
  engine,
  boards: new BoardRegistry({ engine }),
  chats: new ChatRepo(engine),
  miniApps: new MiniAppRepo(engine),
  docs: new DocRepo(engine),
})


let singleton: LocalStores | null = null
let opening: Promise<LocalStores> | null = null


/**
 * The app-wide local stores, opening the IndexedDB engine once on first use.
 * Concurrent callers await the same in-flight open.
 */
export const getLocalStores = async (): Promise<LocalStores> => {
  if (singleton) return singleton
  if (!opening) {
    opening = IndexedDbEngine.open()
      .then((engine) => {
        singleton = createLocalStores(engine)
        return singleton
      })
      .catch((err) => {
        // Don't cache a rejected open — otherwise one transient failure poisons
        // every later call. Reset so the next getLocalStores() retries.
        opening = null
        throw err
      })
  }
  return opening
}


/** Close and clear the singleton. For tests — pair with a fresh IndexedDB. */
export const resetLocalStores = (): void => {
  singleton?.engine.close()
  singleton = null
  opening = null
}
