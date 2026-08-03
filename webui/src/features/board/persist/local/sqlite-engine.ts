/**
 * SQLite implementation of `StorageEngine` — the desktop (Tauri) storage backend.
 *
 * Mirrors `IndexedDbEngine` semantics over a SQL database: one table per
 * collection (see `sqlite-schema.ts`), the value stored as a JSON `data` column,
 * and key/index fields mirrored into affinity-free columns so ranges, secondary
 * indexes, ordering, and atomic transactions all resolve in SQL. Repositories are
 * unchanged — this is a drop-in swap for `IndexedDbEngine` behind the port.
 *
 * The concrete SQL driver is injected (`SqlDb`) so the same engine runs on the
 * Tauri rusqlite commands (`sql_execute`/`sql_select`/`sql_tx`) in production and
 * on an in-process SQLite in tests — both exercised by `runEngineContract`.
 */
import { isKeyRange } from "./engine"
import type { Collection, Key, KeyRange, Query, StorageEngine, Txn } from "./engine"
import { ALL_DDL, tablePlan } from "./sqlite-schema"
import type { TablePlan } from "./sqlite-schema"


/** Values a SQL driver can bind/return. */
export type SqlValue = string | number | null


/** One statement in a transaction batch. */
export type SqlStatement = { sql: string; params?: SqlValue[] }


/**
 * Minimal SQL driver the engine needs. Satisfied by the Tauri rusqlite commands
 * in production and by an in-process SQLite adapter in tests. `batch` MUST run
 * its statements in one atomic transaction (all-or-nothing) — that is what makes
 * `tx()` real; separate `execute` calls are not guaranteed to be transactional.
 */
export interface SqlDb {
  execute(query: string, bind?: SqlValue[]): Promise<void>
  select<T = Record<string, unknown>>(query: string, bind?: SqlValue[]): Promise<T[]>
  batch(statements: SqlStatement[]): Promise<void>
  close(): Promise<void>
}


const asArray = (kp: string | string[]): string[] => (Array.isArray(kp) ? kp : [kp])

const keyToArray = (key: Key): SqlValue[] => (Array.isArray(key) ? key : [key])

const field = (value: unknown, name: string): SqlValue =>
  ((value as Record<string, unknown>)[name] ?? null) as SqlValue


/** `col = ?`-per-column match for an exact (primary) key lookup. */
const eqClause = (cols: string[]): string => cols.map((c) => `"${c}" = ?`).join(" AND ")


/** One bound comparison over `cols` (row-value tuple when compound). */
const compare = (cols: string[], op: string): string =>
  cols.length === 1
    ? `"${cols[0]}" ${op} ?`
    : `(${cols.map((c) => `"${c}"`).join(", ")}) ${op} (${cols.map(() => "?").join(", ")})`


/** Translate a `KeyRange` over `cols` into a WHERE fragment + bound params. */
const rangeClause = (cols: string[], r: KeyRange): { sql: string; params: SqlValue[] } => {
  const parts: string[] = []
  const params: SqlValue[] = []
  // A bound may be a prefix of a compound key (fewer values than pk columns);
  // compare only the columns it provides, so the placeholder count matches the
  // param count and the prefix semantics track the IndexedDb/in-memory engines.
  const addBound = (op: string, key: Key): void => {
    const vals = keyToArray(key)
    parts.push(compare(cols.slice(0, vals.length), op))
    params.push(...vals)
  }
  if (r.lower !== undefined) addBound(r.lowerOpen ? ">" : ">=", r.lower)
  if (r.upper !== undefined) addBound(r.upperOpen ? "<" : "<=", r.upper)
  return { sql: parts.join(" AND "), params }
}


export class SqliteEngine implements StorageEngine {
  private readonly db: SqlDb


  private constructor(db: SqlDb) {
    this.db = db
  }


  /**
   * Open the desktop SQLite database (rusqlite, opened by the Tauri shell) and
   * run migrations. Drives the `sql_execute` / `sql_select` / `sql_tx` commands.
   */
  static async open(): Promise<SqliteEngine> {
    const { invoke } = await import("@tauri-apps/api/core")
    const db: SqlDb = {
      execute: async (sql, params = []) => {
        await invoke("sql_execute", { sql, params })
      },
      select: <T>(sql: string, params: SqlValue[] = []) =>
        invoke<T[]>("sql_select", { sql, params }),
      batch: async (statements) => {
        await invoke("sql_tx", { statements })
      },
      close: async () => {},
    }
    return SqliteEngine.fromDb(db)
  }


  /**
   * Build an engine over an already-open driver (used by tests).
   *
   * Applies the schema idempotently (`CREATE ... IF NOT EXISTS`). NOTE: this is
   * create-only, not a migration system — a future change to `COLLECTIONS` (a new
   * mirrored column or index) will NOT alter an existing desktop DB, and a
   * `CREATE INDEX` on a not-yet-added column would then throw. Before any such
   * schema change ships, this needs versioned migrations (e.g. `PRAGMA
   * user_version` + per-version steps), like the IndexedDB engine's upgrades. Fine
   * today: the schema is v1 and stable. (Follow-up; see docs/adr/ADR-DESKTOP-001.)
   */
  static async fromDb(db: SqlDb): Promise<SqliteEngine> {
    const engine = new SqliteEngine(db)
    for (const stmt of ALL_DDL) await db.execute(stmt)
    return engine
  }


  private plan(c: Collection): TablePlan {
    return tablePlan(c)
  }


  /** Primary-key column values for a write: from the value, or the out-of-line key. */
  private pkValues(p: TablePlan, value: unknown, key?: Key): SqlValue[] {
    if (p.keyPath === null) {
      if (key === undefined) throw new Error(`${p.name}: out-of-line key required`)
      if (Array.isArray(key)) throw new Error(`${p.name}: compound out-of-line keys unsupported`)
      return [key]
    }
    return asArray(p.keyPath).map((f) => field(value, f))
  }


  // Serialize every operation through one async queue so reads, writes, and whole
  // transactions run one-at-a-time. This gives a `tx`'s read-modify-write the same
  // isolation IndexedDB's readwrite transaction does — another op can't interleave
  // between a tx's reads and its buffered flush and cause a lost update. Global
  // serialization is free here: SQLite serializes writes anyway and this is a
  // single-user local DB. The public methods queue; the `_`-prefixed impls don't,
  // so a tx's internal reads (which run inside the queued slot) never self-deadlock.
  private tail: Promise<unknown> = Promise.resolve()


  private serialize<R>(op: () => Promise<R>): Promise<R> {
    const run = this.tail.then(op, op)
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }


  get<T>(c: Collection, key: Key): Promise<T | undefined> {
    return this.serialize(() => this._get<T>(c, key))
  }


  list<T>(c: Collection, q: Query = {}): Promise<T[]> {
    return this.serialize(() => this._list<T>(c, q))
  }


  put<T>(c: Collection, value: T, key?: Key): Promise<void> {
    return this.serialize(() => this._put(c, value, key))
  }


  delete(c: Collection, key: Key | KeyRange): Promise<void> {
    return this.serialize(() => this._delete(c, key))
  }


  tx<R>(collections: Collection[], fn: (t: Txn) => Promise<R>): Promise<R> {
    return this.serialize(() => this._tx(collections, fn))
  }


  private async _get<T>(c: Collection, key: Key): Promise<T | undefined> {
    const p = this.plan(c)
    const rows = await this.db.select<{ data: string }>(
      `SELECT "data" FROM "${c}" WHERE ${eqClause(p.pk)} LIMIT 1`,
      keyToArray(key),
    )
    return rows[0] ? (JSON.parse(rows[0].data) as T) : undefined
  }


  private async _list<T>(c: Collection, q: Query = {}): Promise<T[]> {
    const p = this.plan(c)
    let cols = p.pk
    const filters: string[] = []
    if (q.index) {
      const idx = p.indexes.find((i) => i.name === q.index)
      if (!idx) throw new Error(`${c}: unknown index "${q.index}"`)
      cols = [idx.col]
      // IndexedDB index iteration skips records missing the indexed key; match it.
      filters.push(`"${idx.col}" IS NOT NULL`)
    }
    const range = q.range ? rangeClause(cols, q.range) : { sql: "", params: [] }
    if (range.sql) filters.push(range.sql)
    const dir = q.order === "desc" ? "DESC" : "ASC"
    // Index reads order by the index column first, then the pk for a stable tie-break.
    const orderCols = [...new Set(q.index ? [...cols, ...p.pk] : p.pk)]
    const orderBy = orderCols.map((col) => `"${col}" ${dir}`).join(", ")
    const rows = await this.db.select<{ data: string }>(
      `SELECT "data" FROM "${c}"${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""} ORDER BY ${orderBy}`,
      range.params,
    )
    return rows.map((r) => JSON.parse(r.data) as T)
  }


  /** Build the INSERT-OR-REPLACE for a value, plus its primary-key values. */
  private putStatement(p: TablePlan, value: unknown, key?: Key): SqlStatement & { pk: SqlValue[] } {
    const colValue = new Map<string, SqlValue>()
    const pkv = this.pkValues(p, value, key)
    p.pk.forEach((col, i) => colValue.set(col, pkv[i]))
    p.indexes.forEach((idx) => colValue.set(idx.col, field(value, idx.col)))
    const cols = [...colValue.keys()]
    const sql =
      `INSERT OR REPLACE INTO "${p.name}" (${[...cols, "data"].map((col) => `"${col}"`).join(", ")}) ` +
      `VALUES (${[...cols, "data"].map(() => "?").join(", ")})`
    const params: SqlValue[] = [...cols.map((col) => colValue.get(col) ?? null), JSON.stringify(value)]
    return { sql, params, pk: pkv }
  }


  /** Build the DELETE for a single key or a key range. */
  private deleteStatement(p: TablePlan, key: Key | KeyRange): SqlStatement {
    if (isKeyRange(key)) {
      const r = rangeClause(p.pk, key)
      return { sql: `DELETE FROM "${p.name}"${r.sql ? ` WHERE ${r.sql}` : ""}`, params: r.params }
    }
    return { sql: `DELETE FROM "${p.name}" WHERE ${eqClause(p.pk)}`, params: keyToArray(key) }
  }


  private async _put<T>(c: Collection, value: T, key?: Key): Promise<void> {
    const { sql, params } = this.putStatement(this.plan(c), value, key)
    await this.db.execute(sql, params)
  }


  private async _delete(c: Collection, key: Key | KeyRange): Promise<void> {
    const { sql, params } = this.deleteStatement(this.plan(c), key)
    await this.db.execute(sql, params)
  }


  /**
   * Run `fn` atomically. Writes made through the `Txn` handle are BUFFERED and
   * flushed as one transaction (`SqlDb.batch`) only if `fn` resolves; if it throws,
   * the buffer is discarded and nothing is written. That buffering is what makes
   * `tx` truly atomic — issuing BEGIN/COMMIT as separate driver calls is not.
   *
   * Isolation: the whole tx runs inside one `serialize` slot, so no other engine
   * op interleaves between its reads and its flush (no lost updates).
   *
   * Read-your-writes: `get` overlays this tx's buffered single-key puts/deletes.
   * NOT overlaid (committed reads only): `list` results, and `get` of a key covered
   * by a buffered RANGE delete. No caller reads its own uncommitted writes that way,
   * and the contract doesn't require it; revisit if that changes.
   */
  private async _tx<R>(_collections: Collection[], fn: (t: Txn) => Promise<R>): Promise<R> {
    const writes: SqlStatement[] = []
    const overlay = new Map<string, { value?: unknown; deleted?: boolean }>()
    const okey = (c: Collection, key: Key): string => `${c}:${JSON.stringify(keyToArray(key))}`

    const handle: Txn = {
      get: async <T>(c: Collection, key: Key): Promise<T | undefined> => {
        const o = overlay.get(okey(c, key))
        if (o) return o.deleted ? undefined : (o.value as T)
        return this._get<T>(c, key)
      },
      list: (c, q) => this._list(c, q),
      put: async (c, value, key) => {
        const p = this.plan(c)
        const st = this.putStatement(p, value, key)
        writes.push({ sql: st.sql, params: st.params })
        overlay.set(`${c}:${JSON.stringify(st.pk)}`, { value })
      },
      delete: async (c, key) => {
        const p = this.plan(c)
        writes.push(this.deleteStatement(p, key))
        if (!isKeyRange(key)) overlay.set(okey(c, key), { deleted: true })
      },
    }

    const result = await fn(handle)
    if (writes.length) await this.db.batch(writes)
    return result
  }


  close(): void {
    void this.db.close()
  }
}
