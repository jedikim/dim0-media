/**
 * SQLite schema derived from the shared `COLLECTIONS` descriptor (`schema.ts`),
 * so the desktop SQLite engine and the IndexedDB engine build the same stores,
 * keys, and indexes from ONE source. One table per collection: the value is a
 * JSON `data` column, and each primary-key / secondary-index field is mirrored
 * into its own column so ranges, indexes, and ordering work in SQL.
 *
 * Key/index columns are declared with NO type → BLOB ("no") affinity, which
 * stores each bound value with its original type. That preserves SQLite's
 * NULL < number < text ordering, matching IndexedDB's key ordering so both
 * engines satisfy the same `runEngineContract`.
 */
import { COLLECTIONS } from "./schema"
import type { Collection } from "./engine"


/** Column holding an out-of-line (caller-supplied) key when `keyPath` is null. */
export const OUT_OF_LINE_KEY = "_key"


export type SqliteIndex = {
  /** The port's index name (`Query.index`), e.g. "by-board". */
  name: string
  /** The column/value field it mirrors, e.g. "boardId". */
  col: string
}


export type TablePlan = {
  name: Collection
  /** Primary-key column names, in order. */
  pk: string[]
  /** The value fields backing the pk (null ⇒ out-of-line key in `_key`). */
  keyPath: string | string[] | null
  indexes: SqliteIndex[]
}


const asArray = (kp: string | string[]): string[] => (Array.isArray(kp) ? kp : [kp])


/** Build the table plan for one collection from its `COLLECTIONS` entry. */
export const tablePlan = (name: Collection): TablePlan => {
  const s = COLLECTIONS[name]
  const pk = s.keyPath === null ? [OUT_OF_LINE_KEY] : asArray(s.keyPath)
  const indexes = Object.entries(s.indexes ?? {}).map(([indexName, field]) => ({
    name: indexName,
    col: field,
  }))
  return { name, pk, keyPath: s.keyPath, indexes }
}


export const ALL_TABLE_PLANS: TablePlan[] = (Object.keys(COLLECTIONS) as Collection[]).map(
  tablePlan,
)


/** Distinct non-`data` columns for a table, in a stable order (pk then indexes). */
export const columnsOf = (p: TablePlan): string[] => [
  ...new Set([...p.pk, ...p.indexes.map((i) => i.col)]),
]


/** Idempotent `CREATE TABLE` + `CREATE INDEX` statements for one collection. */
export const ddlFor = (p: TablePlan): string[] => {
  const cols = columnsOf(p)
  const colDefs = cols.map((c) => `"${c}"`).join(", ")
  const create =
    `CREATE TABLE IF NOT EXISTS "${p.name}" (` +
    `${colDefs}${cols.length ? ", " : ""}"data" TEXT NOT NULL, ` +
    `PRIMARY KEY (${p.pk.map((c) => `"${c}"`).join(", ")}))`
  const indexes = p.indexes
    .filter((i) => !p.pk.includes(i.col))
    .map(
      (i) => `CREATE INDEX IF NOT EXISTS "${p.name}_${i.col}" ON "${p.name}" ("${i.col}")`,
    )
  return [create, ...indexes]
}


export const ALL_DDL: string[] = ALL_TABLE_PLANS.flatMap(ddlFor)
