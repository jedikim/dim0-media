/**
 * StorageEngine — the local-persistence port.
 *
 * This is the single seam a non-browser build reimplements (e.g. a desktop
 * SQLite adapter). Repositories are written once against this interface, so
 * swapping the engine swaps the entire storage backend. The surface is kept
 * generic and transaction-capable, and deliberately honest for both IndexedDB
 * and SQLite — both do keys, ranges, secondary indexes, and atomic transactions
 * natively. A raw-filesystem backend is out of scope (no ranges/indexes/atomicity).
 */

/**
 * Logical stores. Stable across engines — these are the app's data model, not an
 * IndexedDB detail — so a SQLite adapter maps the same names to tables.
 */
export type Collection =
  | "snapshots"
  | "oplog"
  | "boards"
  | "views"
  | "chats"
  | "chat_messages"
  | "mini_app_state"
  | "sync_meta"
  | "snapshot_meta"
  | "documents"
  | "chunks"
  | "memories"


/** A primary or index key: a scalar, or a compound (array) key. */
export type Key = string | number | (string | number)[]


/**
 * An engine-agnostic key range (no `IDBKeyRange`). Bounds are inclusive unless
 * the matching `*Open` flag is set; omitting a bound leaves that side open.
 */
export type KeyRange = {
  lower?: Key
  upper?: Key
  lowerOpen?: boolean
  upperOpen?: boolean
}


/** A read over a collection: optionally via a secondary index, a range, reversed. */
export type Query = {
  index?: string
  range?: KeyRange
  order?: "asc" | "desc"
}


/**
 * Reads/writes scoped to one atomic transaction (see `StorageEngine.tx`).
 *
 * Caveat: inside a `tx` callback, only await engine operations on this handle.
 * Awaiting anything else (a fetch, a timer) lets the underlying transaction
 * auto-commit and close, and subsequent operations will throw.
 */
export interface Txn {
  get<T>(c: Collection, key: Key): Promise<T | undefined>
  list<T>(c: Collection, q?: Query): Promise<T[]>
  put<T>(c: Collection, value: T, key?: Key): Promise<void>
  delete(c: Collection, key: Key | KeyRange): Promise<void>
}


/** The local persistence port. One instance owns one backing connection. */
export interface StorageEngine {
  /** Fetch a single value by primary key, or `undefined` if absent. */
  get<T>(c: Collection, key: Key): Promise<T | undefined>
  /** List values, optionally narrowed by index/range and reversed by key order. */
  list<T>(c: Collection, q?: Query): Promise<T[]>
  /** Insert or replace. Pass `key` only for stores without an inline key path. */
  put<T>(c: Collection, value: T, key?: Key): Promise<void>
  /** Delete a single key or every key in a range. */
  delete(c: Collection, key: Key | KeyRange): Promise<void>
  /** Run `fn` in one atomic read/write transaction spanning `collections`. */
  tx<R>(collections: Collection[], fn: (t: Txn) => Promise<R>): Promise<R>
  /** Release the backing connection. */
  close(): void
}


/**
 * Type guard distinguishing a `KeyRange` from a plain `Key` in `delete`. A `Key`
 * is a scalar or an array; a `KeyRange` is a non-array object.
 */
export const isKeyRange = (k: Key | KeyRange): k is KeyRange =>
  typeof k === "object" && k !== null && !Array.isArray(k)
