/**
 * In-memory `StorageEngine` — a second implementation of the port, backed by
 * plain Maps. It exists to (1) prove the port is genuinely implementation-
 * agnostic: it passes the SAME contract suite as `IndexedDbEngine`, so if a naive
 * Map-backed store satisfies it, the abstraction isn't IndexedDB-shaped; (2) give
 * tests a fast, deterministic double; (3) serve as the reference template for a
 * future SQLite adapter.
 *
 * It replicates IndexedDB key semantics (number < string, arrays compared
 * element-wise then by length, inclusive/open bounds) so range and index queries
 * behave identically to the real engine.
 */
import { COLLECTIONS } from "./schema"
import { isKeyRange } from "./engine"
import type { Collection, Key, KeyRange, Query, StorageEngine, Txn } from "./engine"


type Row = { key: Key; value: unknown }
type Store = Map<string, Row>


const serialize = (key: Key): string => JSON.stringify(key)


// IndexedDB orders numbers before strings; arrays sort after scalars.
const typeRank = (v: string | number): number => (typeof v === "number" ? 1 : 3)


/** Compare two keys with IndexedDB-like ordering. */
const compareKeys = (a: Key, b: Key): number => {
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr && bArr) {
    const len = Math.min(a.length, b.length)
    for (let i = 0; i < len; i += 1) {
      const c = compareKeys(a[i], b[i])
      if (c !== 0) return c
    }
    return a.length - b.length
  }
  if (aArr) return 1
  if (bArr) return -1
  const rankDiff = typeRank(a) - typeRank(b)
  if (rankDiff !== 0) return rankDiff
  return a < b ? -1 : a > b ? 1 : 0
}


const inRange = (key: Key, range: KeyRange): boolean => {
  if (range.lower !== undefined) {
    const c = compareKeys(key, range.lower)
    if (c < 0 || (c === 0 && range.lowerOpen)) return false
  }
  if (range.upper !== undefined) {
    const c = compareKeys(key, range.upper)
    if (c > 0 || (c === 0 && range.upperOpen)) return false
  }
  return true
}


const extractKey = (value: unknown, keyPath: string | string[]): Key => {
  const v = value as Record<string, string | number>
  return Array.isArray(keyPath) ? keyPath.map((k) => v[k]) : v[keyPath]
}


export class InMemoryEngine implements StorageEngine {
  private data = new Map<Collection, Store>()


  constructor() {
    for (const name of Object.keys(COLLECTIONS) as Collection[]) this.data.set(name, new Map())
  }


  async get<T>(c: Collection, key: Key): Promise<T | undefined> {
    return this.read(c, key) as T | undefined
  }


  async list<T>(c: Collection, q: Query = {}): Promise<T[]> {
    return this.scan(c, q) as T[]
  }


  async put<T>(c: Collection, value: T, key?: Key): Promise<void> {
    this.write(c, value, key)
  }


  async delete(c: Collection, key: Key | KeyRange): Promise<void> {
    this.remove(c, key)
  }


  async tx<R>(collections: Collection[], fn: (t: Txn) => Promise<R>): Promise<R> {
    // Snapshot the touched stores; restore them if the callback throws.
    const backup = new Map(collections.map((c) => [c, new Map(this.store(c))]))
    try {
      return await fn(this.txn())
    } catch (err) {
      for (const [c, snap] of backup) this.data.set(c, snap)
      throw err
    }
  }


  close(): void {
    // In-memory: nothing to release.
  }


  private store(c: Collection): Store {
    const s = this.data.get(c)
    if (!s) throw new Error(`unknown collection: ${c}`)
    return s
  }


  private read(c: Collection, key: Key): unknown {
    return this.store(c).get(serialize(key))?.value
  }


  private write(c: Collection, value: unknown, explicit?: Key): void {
    const keyPath = COLLECTIONS[c].keyPath
    const key = keyPath === null ? explicit : extractKey(value, keyPath)
    if (key === undefined) throw new Error(`${c} requires an explicit key`)
    this.store(c).set(serialize(key), { key, value })
  }


  private remove(c: Collection, key: Key | KeyRange): void {
    const s = this.store(c)
    if (isKeyRange(key)) {
      for (const [sk, row] of s) if (inRange(row.key, key)) s.delete(sk)
    } else {
      s.delete(serialize(key))
    }
  }


  private scan(c: Collection, q: Query): unknown[] {
    const field = q.index ? COLLECTIONS[c].indexes?.[q.index] : undefined
    const keyOf = (row: Row): Key =>
      field ? (row.value as Record<string, string | number>)[field] : row.key
    const rows = [...this.store(c).values()]
    const range = q.range
    const filtered = range ? rows.filter((r) => inRange(keyOf(r), range)) : rows
    filtered.sort((a, b) => compareKeys(keyOf(a), keyOf(b)))
    const values = filtered.map((r) => r.value)
    return q.order === "desc" ? values.reverse() : values
  }


  private txn(): Txn {
    return {
      get: async <T>(c: Collection, key: Key) => this.read(c, key) as T | undefined,
      list: async <T>(c: Collection, query?: Query) => this.scan(c, query ?? {}) as T[],
      put: async <T>(c: Collection, value: T, key?: Key) => {
        this.write(c, value, key)
      },
      delete: async (c: Collection, key: Key | KeyRange) => {
        this.remove(c, key)
      },
    }
  }
}
