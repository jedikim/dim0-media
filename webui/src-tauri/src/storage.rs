//! rusqlite-backed local storage for the desktop app.
//!
//! A single SQLite connection guarded by a mutex, exposed to the webview through
//! three commands. `sql_tx` runs a batch of statements in ONE real transaction
//! (all-or-nothing) — the atomicity a pooled SQL driver cannot provide, because
//! there each statement can land on a different connection. The schema itself is
//! driven from the webui (the `StorageEngine` port owns it); this layer is a thin,
//! typed SQL executor.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::types::{Value, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::Value as Json;
use tauri::State;


/// The app's single SQLite connection (guarded — rusqlite `Connection` is !Sync).
pub struct Db(pub Mutex<Connection>);


/// One statement in a transaction batch: SQL plus its positional bind params.
#[derive(Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}


/// JSON bind value → SQLite value. Bools map to 0/1; integers stay integers so
/// SQLite's number-before-text ordering matches the IndexedDB engine.
fn to_sql(v: &Json) -> Value {
    match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => n
            .as_i64()
            .map(Value::Integer)
            .unwrap_or_else(|| Value::Real(n.as_f64().unwrap_or(0.0))),
        Json::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}


/// SQLite cell → JSON, for returning rows to the webview.
fn from_sql(v: ValueRef<'_>) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => Json::from(f),
        ValueRef::Text(t) => Json::from(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::from(String::from_utf8_lossy(b).into_owned()),
    }
}


/// Run one statement (autocommit); returns rows affected.
fn exec(conn: &Connection, sql: &str, params: &[Json]) -> rusqlite::Result<usize> {
    let vals: Vec<Value> = params.iter().map(to_sql).collect();
    conn.execute(sql, params_from_iter(vals))
}


/// Run a query, returning each row as a `{ column: value }` JSON object.
fn query(conn: &Connection, sql: &str, params: &[Json]) -> rusqlite::Result<Vec<Json>> {
    let vals: Vec<Value> = params.iter().map(to_sql).collect();
    let mut stmt = conn.prepare(sql)?;
    let cols: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map(params_from_iter(vals), |row| {
        let mut obj = serde_json::Map::new();
        for (i, name) in cols.iter().enumerate() {
            obj.insert(name.clone(), from_sql(row.get_ref(i)?));
        }
        Ok(Json::Object(obj))
    })?;
    rows.collect()
}


/// Run every statement in ONE transaction: commit on success, roll back on any
/// error so a failed batch leaves the database untouched.
fn run_tx(conn: &mut Connection, statements: &[Statement]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for st in statements {
        let vals: Vec<Value> = st.params.iter().map(to_sql).collect();
        tx.execute(&st.sql, params_from_iter(vals))?;
    }
    tx.commit()
}


/// Open (or create) the database at `path`, enabling WAL for durable, concurrent
/// reads. The webui drives migrations via `sql_execute`.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", &"WAL")?;
    conn.pragma_update(None, "foreign_keys", &"ON")?;
    Ok(conn)
}


#[tauri::command]
pub fn sql_execute(db: State<'_, Db>, sql: String, params: Vec<Json>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    exec(&conn, &sql, &params).map(|_| ()).map_err(|e| e.to_string())
}


#[tauri::command]
pub fn sql_select(db: State<'_, Db>, sql: String, params: Vec<Json>) -> Result<Vec<Json>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    query(&conn, &sql, &params).map_err(|e| e.to_string())
}


#[tauri::command]
pub fn sql_tx(db: State<'_, Db>, statements: Vec<Statement>) -> Result<(), String> {
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    run_tx(&mut conn, &statements).map_err(|e| e.to_string())
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT)", [])
            .unwrap();
        conn
    }

    #[test]
    fn exec_and_query_round_trip() {
        let conn = mem();
        exec(&conn, "INSERT INTO t (k, v) VALUES (?, ?)", &[json!("a"), json!("alpha")]).unwrap();
        let rows = query(&conn, "SELECT k, v FROM t", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["k"], json!("a"));
        assert_eq!(rows[0]["v"], json!("alpha"));
    }

    #[test]
    fn value_conversions_preserve_types() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE n (i, r, s, z)", []).unwrap();
        exec(
            &conn,
            "INSERT INTO n (i, r, s, z) VALUES (?, ?, ?, ?)",
            &[json!(42), json!(1.5), json!("hi"), json!(null)],
        )
        .unwrap();
        let rows = query(&conn, "SELECT i, r, s, z FROM n", &[]).unwrap();
        assert_eq!(rows[0]["i"], json!(42));
        assert_eq!(rows[0]["r"], json!(1.5));
        assert_eq!(rows[0]["s"], json!("hi"));
        assert_eq!(rows[0]["z"], json!(null));
    }

    #[test]
    fn tx_commits_all_statements_atomically() {
        let mut conn = mem();
        run_tx(
            &mut conn,
            &[
                Statement { sql: "INSERT INTO t (k, v) VALUES (?, ?)".into(), params: vec![json!("a"), json!("1")] },
                Statement { sql: "INSERT INTO t (k, v) VALUES (?, ?)".into(), params: vec![json!("b"), json!("2")] },
            ],
        )
        .unwrap();
        let rows = query(&conn, "SELECT k FROM t ORDER BY k", &[]).unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn tx_rolls_back_every_write_on_error() {
        let mut conn = mem();
        exec(&conn, "INSERT INTO t (k, v) VALUES (?, ?)", &[json!("keep"), json!("x")]).unwrap();
        // The second insert violates the PRIMARY KEY → the whole batch must roll back.
        let res = run_tx(
            &mut conn,
            &[
                Statement { sql: "INSERT INTO t (k, v) VALUES (?, ?)".into(), params: vec![json!("new"), json!("1")] },
                Statement { sql: "INSERT INTO t (k, v) VALUES (?, ?)".into(), params: vec![json!("keep"), json!("dup")] },
            ],
        );
        assert!(res.is_err());
        // "new" must NOT persist (rollback); "keep" untouched.
        let rows = query(&conn, "SELECT k FROM t ORDER BY k", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["k"], json!("keep"));
    }
}
