# ADR-DESKTOP-001: Desktop local storage is rusqlite (single connection, atomic `sql_tx`)

**Status:** Accepted · 2026-08-01
**Applies to:** `webui/src-tauri/src/storage.rs`, `webui/src/features/board/persist/local/sqlite-engine.ts`, `webui/src/features/board/persist/local/sqlite-schema.ts`, `webui/src/features/local-stores.ts`

## Decision
The Tauri desktop build MUST back the `StorageEngine` port with **rusqlite** over a
single `Mutex<Connection>` (`storage.rs`), exposed as three commands
(`sql_execute` / `sql_select` / `sql_tx`) — NOT a pooled SQL driver. `getLocalStores`
selects `SqliteEngine` when `isTauri()`, else `IndexedDbEngine`.

- Multi-statement transactions MUST run through the **one** `sql_tx` command (one
  real `rusqlite` transaction, all-or-nothing). The JS `SqliteEngine.tx()` MUST
  buffer the callback's writes (+ a `get` overlay for read-your-writes) and flush
  them via `SqlDb.batch` → `sql_tx`. It MUST NOT issue `BEGIN`/`COMMIT` as separate
  `execute` calls.
- `SqliteEngine` MUST serialize every operation (and whole `tx`) through one async
  queue so a tx's read-modify-write can't interleave with another op.
- The SQL schema MUST derive from the shared `COLLECTIONS` descriptor
  (`sqlite-schema.ts`), so the SQLite and IndexedDB engines build identical stores.

## Why
`@tauri-apps/plugin-sql` runs each statement against a **connection pool**, so
`BEGIN`, the writes, and `COMMIT` land on *different* connections — the inner
writes autocommit and `tx()` is not atomic. That silently breaks the invariants
the repos depend on: `deleteBoard`'s 9-store cascade, `writeSnapshot`'s
snapshot+oplog-truncate crash-safety, and `saveTranscript`'s delete+insert. The
in-process `sql.js` contract test can't catch it (single connection), so it would
ship green. rusqlite with one held connection gives a genuine transaction;
serializing the engine reproduces IndexedDB's readwrite-transaction isolation.
(Regressed once — the first desktop draft used `tauri-plugin-sql` and the code
review caught the non-atomic `tx`.)

## Consequences
- Rust `cargo test` covers the transaction primitive (`tx_commits…`,
  `tx_rolls_back_every_write_on_error`); `make test-tauri` + a `tauri` CI job run it.
- `SqliteEngine` still passes the shared `runEngineContract` (via `sql.js`), so
  IndexedDB/SQLite parity is enforced; a serialization test covers isolation.
- No read-your-writes for a tx's own `list()` or a key under a buffered *range*
  delete (committed reads); no caller relies on it — documented in `tx()`.
- WAL is enabled on open for durable, concurrent reads. DB lives in the app-data dir.
- **Known follow-up:** the schema is applied create-only (`CREATE ... IF NOT EXISTS`
  from `COLLECTIONS`), NOT migrated. Before any `COLLECTIONS` change ships to
  desktop, `fromDb` needs versioned migrations (`PRAGMA user_version` + steps), like
  the IndexedDB engine's upgrades — else an added column/index bricks existing DBs.

## Rejected alternatives
- **`tauri-plugin-sql`** — pooled connections make multi-statement `tx` non-atomic;
  no JS-only fix (can't pin the pool to one connection; a bound multi-statement
  query only runs its first statement).
- **Loose files (JSON per board)** — no ranges/indexes/atomic multi-file writes; the
  port needs all three (see `analysis/architecture/offline-first-storage-interface.md`).
- **`BEGIN`/`COMMIT` as separate `execute` calls** — see Why (not transactional on a pool).

## Verify
`grep -n "run_tx\|transaction()\|Mutex<Connection>" webui/src-tauri/src/storage.rs` — one connection, one real transaction.
`grep -n "serialize\|this.db.batch\|BEGIN" webui/src/features/board/persist/local/sqlite-engine.ts` — ops serialized, tx flushes via the atomic batch, no inline BEGIN/COMMIT.
