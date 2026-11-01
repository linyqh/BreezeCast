use anyhow::Result;
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use std::path::Path;

/// Document store: each table holds JSON documents keyed by id.
pub struct Db {
    conn: Mutex<Connection>,
}

pub const TABLES: [&str; 4] = ["voices", "clips", "shows", "episodes"];

impl Db {
    pub fn open(path: &Path) -> Result<Db> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        for t in TABLES {
            conn.execute_batch(&format!(
                "CREATE TABLE IF NOT EXISTS {t} (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL);"
            ))?;
        }
        Ok(Db { conn: Mutex::new(conn) })
    }

    pub fn put<T: Serialize>(&self, table: &str, id: &str, created_at: &str, doc: &T) -> Result<()> {
        let data = serde_json::to_string(doc)?;
        self.conn.lock().execute(
            &format!("INSERT INTO {table} (id, data, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = excluded.data"),
            params![id, data, created_at],
        )?;
        Ok(())
    }

    pub fn get<T: DeserializeOwned>(&self, table: &str, id: &str) -> Result<Option<T>> {
        let conn = self.conn.lock();
        let data: Option<String> = conn
            .query_row(&format!("SELECT data FROM {table} WHERE id = ?1"), params![id], |r| r.get(0))
            .optional()?;
        Ok(match data {
            Some(d) => Some(serde_json::from_str(&d)?),
            None => None,
        })
    }

    /// Newest first.
    pub fn list<T: DeserializeOwned>(&self, table: &str, limit: Option<usize>) -> Result<Vec<T>> {
        let conn = self.conn.lock();
        let sql = format!(
            "SELECT data FROM {table} ORDER BY created_at DESC LIMIT {}",
            limit.map(|l| l as i64).unwrap_or(-1)
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    pub fn delete(&self, table: &str, id: &str) -> Result<bool> {
        Ok(self.conn.lock().execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id])? > 0)
    }
}
