/**
 * Engine cases for parameterized repo tests. Each repo is run against every
 * `StorageEngine` implementation so it's proven engine-agnostic (and the future
 * SQLite adapter drops in the same way). `make` returns a fresh, empty engine.
 */
import { resetIdb } from "./canvas"
import { IndexedDbEngine } from "@/features/board/persist/local/indexeddb-engine"
import { InMemoryEngine } from "@/features/board/persist/local/in-memory-engine"
import type { StorageEngine } from "@/features/board/persist/local/engine"


export const engineCases: { label: string; make: () => Promise<StorageEngine> }[] = [
  {
    label: "IndexedDbEngine",
    make: async () => {
      resetIdb()
      return IndexedDbEngine.open()
    },
  },
  {
    label: "InMemoryEngine",
    make: () => Promise.resolve(new InMemoryEngine()),
  },
]
