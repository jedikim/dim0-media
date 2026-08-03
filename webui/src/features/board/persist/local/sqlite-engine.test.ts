// @vitest-environment node
//
// Runs the shared StorageEngine port contract against SqliteEngine, backed by an
// in-process SQLite (sql.js, pure-wasm — no native build). Node environment so
// sql.js loads its wasm via fs. This is the parity check that makes the desktop
// SQLite backend a safe swap for IndexedDB.
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import initSqlJs from "sql.js"
import { runEngineContract } from "./engine-contract"
import { SqliteEngine } from "./sqlite-engine"
import type { SqlDb, SqlValue } from "./sqlite-engine"


const require = createRequire(import.meta.url)


const makeEngine = async (): Promise<SqliteEngine> => {
  const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") })
  const db = new SQL.Database()
  const adapter: SqlDb = {
    execute: async (query, bind = []) => {
      db.run(query, bind)
    },
    select: async <T,>(query: string, bind: SqlValue[] = []): Promise<T[]> => {
      const stmt = db.prepare(query)
      stmt.bind(bind)
      const out: T[] = []
      while (stmt.step()) out.push(stmt.getAsObject() as T)
      stmt.free()
      return out
    },
    // Atomic batch: one in-process connection, so BEGIN/COMMIT is a real
    // transaction; roll back on any error (mirrors the rusqlite sql_tx command).
    batch: async (statements) => {
      db.run("BEGIN")
      try {
        for (const s of statements) db.run(s.sql, s.params ?? [])
        db.run("COMMIT")
      } catch (e) {
        db.run("ROLLBACK")
        throw e
      }
    },
    close: async () => {
      db.close()
    },
  }
  return SqliteEngine.fromDb(adapter)
}


runEngineContract("SqliteEngine (sql.js)", makeEngine)


describe("SqliteEngine transaction isolation", () => {
  it("serializes concurrent read-modify-write transactions (no lost update)", async () => {
    const e = await makeEngine()
    await e.put("boards", { id: "b", title: "0" })
    // Each tx reads the counter, then writes +1. Run three at once: without
    // serialization all three would read "0" and the result would be "1" (lost
    // updates); serialized, they apply in turn → "3".
    const bump = () =>
      e.tx(["boards"], async (t) => {
        const cur = await t.get<{ id: string; title: string }>("boards", "b")
        await t.put("boards", { id: "b", title: String(Number(cur?.title ?? "0") + 1) })
      })
    await Promise.all([bump(), bump(), bump()])
    const final = await e.get<{ title: string }>("boards", "b")
    expect(final?.title).toBe("3")
    e.close()
  })
})
