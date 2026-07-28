/**
 * IndexedDB implementation of `StorageEngine`.
 *
 * Wraps the typed `openDim0Db` handle (schema + upgrades live in `idb.ts`) and
 * presents the engine's generic, collection-addressed surface. This is the one
 * browser adapter behind every repository; a desktop build swaps in a SQLite
 * adapter with the same interface and the repos are unchanged.
 */
import { openDim0Db } from "./idb"
import type { Dim0Database } from "./idb"
import { isKeyRange } from "./engine"
import type { Collection, Key, KeyRange, Query, StorageEngine, Txn } from "./engine"


// Loose views over the typed idb handle. The engine is intentionally generic
// over collections, so it bypasses idb's per-store value typing — repos supply
// the concrete `<T>` at each call site. Casting to these shapes keeps the unsafe
// boundary to one spot.
type AnyStore = {
  get(key: IDBValidKey | IDBKeyRange): Promise<unknown>
  getAll(query?: IDBValidKey | IDBKeyRange | null): Promise<unknown[]>
  put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey>
  delete(key: IDBValidKey | IDBKeyRange): Promise<void>
  index(name: string): { getAll(query?: IDBValidKey | IDBKeyRange | null): Promise<unknown[]> }
}

type AnyTx = {
  objectStore(name: string): AnyStore
  abort(): void
  done: Promise<void>
}

type AnyDb = {
  get(store: string, key: IDBValidKey | IDBKeyRange): Promise<unknown>
  getAll(store: string, query?: IDBValidKey | IDBKeyRange | null): Promise<unknown[]>
  getAllFromIndex(store: string, index: string, query?: IDBValidKey | IDBKeyRange | null): Promise<unknown[]>
  put(store: string, value: unknown, key?: IDBValidKey): Promise<IDBValidKey>
  delete(store: string, key: IDBValidKey | IDBKeyRange): Promise<void>
  transaction(stores: string[], mode: "readwrite"): AnyTx
  close(): void
}


/** Translate an engine `KeyRange` to an `IDBKeyRange`. */
export const toIdbRange = (r: KeyRange): IDBKeyRange => {
  const { lower, upper, lowerOpen = false, upperOpen = false } = r
  if (lower !== undefined && upper !== undefined) return IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen)
  if (lower !== undefined) return IDBKeyRange.lowerBound(lower, lowerOpen)
  if (upper !== undefined) return IDBKeyRange.upperBound(upper, upperOpen)
  throw new Error("KeyRange requires at least one of lower/upper")
}


const applyOrder = <T>(rows: T[], order: "asc" | "desc" = "asc"): T[] =>
  order === "desc" ? rows.reverse() : rows


/** Wrap a live idb transaction as the engine's `Txn` handle. */
const wrapTxn = (tx: AnyTx): Txn => ({
  get: async <T>(c: Collection, key: Key) =>
    (await tx.objectStore(c).get(key)) as T | undefined,
  list: async <T>(c: Collection, q: Query = {}) => {
    const store = tx.objectStore(c)
    const range = q.range ? toIdbRange(q.range) : null
    const rows = q.index ? await store.index(q.index).getAll(range) : await store.getAll(range)
    return applyOrder(rows as T[], q.order)
  },
  put: async <T>(c: Collection, value: T, key?: Key) => {
    await tx.objectStore(c).put(value, key)
  },
  delete: async (c: Collection, key: Key | KeyRange) => {
    await tx.objectStore(c).delete(isKeyRange(key) ? toIdbRange(key) : key)
  },
})


export class IndexedDbEngine implements StorageEngine {
  private readonly db: Dim0Database


  private constructor(db: Dim0Database) {
    this.db = db
  }


  /** Open (creating/upgrading) the dim0 database. `dbName` is overridable for tests. */
  static async open(dbName?: string): Promise<IndexedDbEngine> {
    return new IndexedDbEngine(await openDim0Db(dbName))
  }


  private get raw(): AnyDb {
    return this.db as unknown as AnyDb
  }


  async get<T>(c: Collection, key: Key): Promise<T | undefined> {
    return (await this.raw.get(c, key)) as T | undefined
  }


  async list<T>(c: Collection, q: Query = {}): Promise<T[]> {
    const range = q.range ? toIdbRange(q.range) : null
    const rows = q.index
      ? await this.raw.getAllFromIndex(c, q.index, range)
      : await this.raw.getAll(c, range)
    return applyOrder(rows as T[], q.order)
  }


  async put<T>(c: Collection, value: T, key?: Key): Promise<void> {
    await this.raw.put(c, value, key)
  }


  async delete(c: Collection, key: Key | KeyRange): Promise<void> {
    await this.raw.delete(c, isKeyRange(key) ? toIdbRange(key) : key)
  }


  async tx<R>(collections: Collection[], fn: (t: Txn) => Promise<R>): Promise<R> {
    const tx = this.raw.transaction(collections, "readwrite")
    try {
      const result = await fn(wrapTxn(tx))
      await tx.done
      return result
    } catch (err) {
      // Roll back: abort so already-scheduled writes never commit. Without this
      // the transaction would auto-commit its pending requests once idle.
      void tx.done.catch(() => undefined)
      try {
        tx.abort()
      } catch {
        // Already settled (committed or aborted) — nothing to roll back.
      }
      throw err
    }
  }


  close(): void {
    this.db.close()
  }
}
