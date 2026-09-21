use async_trait::async_trait;
use sqlx::sqlite::SqliteConnection;
use sqlx::{Column as _, Connection as _, Row, TypeInfo};
use tokio::sync::Mutex;

use crate::drivers::Driver;
use crate::error::{AppError, AppResult};
use crate::executor::sqlite_row_to_values;
use crate::types::{
    Column, ColumnInfo, ConnectionConfig, ForeignKey, QueryResult, TableInfo, MAX_ROWS,
};

pub struct SqliteDriver {
    conn: Mutex<SqliteConnection>,
}

/// Build a sqlx connection URL. `:memory:` maps to a shared in-memory DB;
/// a file path is opened read/write, creating it if absent.
pub fn sqlite_url(database: &str) -> String {
    if database == ":memory:" {
        "sqlite::memory:".to_string()
    } else {
        format!("sqlite:{database}?mode=rwc")
    }
}

impl SqliteDriver {
    pub async fn connect(cfg: &ConnectionConfig) -> AppResult<Self> {
        let conn = SqliteConnection::connect(&sqlite_url(&cfg.database)).await?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub async fn test(cfg: &ConnectionConfig) -> AppResult<()> {
        let mut conn = SqliteConnection::connect(&sqlite_url(&cfg.database)).await?;
        sqlx::query("SELECT 1").execute(&mut conn).await?;
        conn.close().await?;
        Ok(())
    }
}

#[async_trait]
impl Driver for SqliteDriver {
    async fn execute(&self, sql: &str) -> AppResult<QueryResult> {
        let started = std::time::Instant::now();
        let mut conn = self.conn.lock().await;
        let head = sql.trim_start().to_uppercase();
        let returns_rows = head.starts_with("SELECT")
            || head.starts_with("PRAGMA")
            || head.starts_with("WITH")
            || head.starts_with("EXPLAIN");

        if !returns_rows {
            let res = sqlx::query(sql).execute(&mut *conn).await?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: res.rows_affected(),
                elapsed_ms: started.elapsed().as_millis() as u64,
                truncated: false,
            });
        }

        let fetched = sqlx::query(sql).fetch_all(&mut *conn).await?;
        let columns = match fetched.first() {
            Some(first) => first
                .columns()
                .iter()
                .map(|c| Column {
                    name: c.name().to_string(),
                    data_type: c.type_info().name().to_string(),
                })
                .collect(),
            None => vec![],
        };
        let truncated = fetched.len() > MAX_ROWS;
        let mut rows = Vec::with_capacity(fetched.len().min(MAX_ROWS));
        for row in fetched.iter().take(MAX_ROWS) {
            rows.push(sqlite_row_to_values(row)?);
        }
        Ok(QueryResult {
            columns,
            rows,
            rows_affected: 0,
            elapsed_ms: started.elapsed().as_millis() as u64,
            truncated,
        })
    }

    async fn list_tables(&self) -> AppResult<Vec<TableInfo>> {
        let mut conn = self.conn.lock().await;
        let rows = sqlx::query(
            "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&mut *conn)
        .await?;
        Ok(rows
            .iter()
            .map(|r| TableInfo {
                name: r.try_get::<String, _>("name").unwrap_or_default(),
                kind: r
                    .try_get::<String, _>("type")
                    .unwrap_or_else(|_| "table".into()),
                schema: None,
            })
            .collect())
    }

    async fn list_columns(&self, table: &str) -> AppResult<Vec<ColumnInfo>> {
        if table.is_empty() {
            return Err(AppError::Internal("invalid table name".into()));
        }
        let ident = format!("\"{}\"", table.replace('"', "\"\""));
        let mut conn = self.conn.lock().await;
        let rows = sqlx::query(&format!("PRAGMA table_info({ident})"))
            .fetch_all(&mut *conn)
            .await?;
        Ok(rows
            .iter()
            .map(|r| ColumnInfo {
                name: r.try_get::<String, _>("name").unwrap_or_default(),
                data_type: r.try_get::<String, _>("type").unwrap_or_default(),
                nullable: r.try_get::<i64, _>("notnull").unwrap_or(0) == 0,
                is_primary_key: r.try_get::<i64, _>("pk").unwrap_or(0) > 0,
            })
            .collect())
    }

    async fn list_foreign_keys(&self) -> AppResult<Vec<ForeignKey>> {
        let mut conn = self.conn.lock().await;
        let tables = sqlx::query(
            "SELECT name FROM sqlite_master \
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&mut *conn)
        .await?;
        let mut out = Vec::new();
        for table_row in tables {
            let table: String = table_row.try_get("name").unwrap_or_default();
            let ident = format!("\"{}\"", table.replace('"', "\"\""));
            let rows = sqlx::query(&format!("PRAGMA foreign_key_list({ident})"))
                .fetch_all(&mut *conn)
                .await?;
            for row in rows {
                out.push(ForeignKey {
                    table: table.clone(),
                    column: row.try_get("from").unwrap_or_default(),
                    ref_table: row.try_get("table").unwrap_or_default(),
                    ref_column: row.try_get("to").unwrap_or_default(),
                });
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Engine;

    fn mem_cfg() -> ConnectionConfig {
        ConnectionConfig {
            id: "t".into(),
            name: "mem".into(),
            engine: Engine::Sqlite,
            host: None,
            port: None,
            database: ":memory:".into(),
            username: None,
            env: None,
        }
    }

    #[tokio::test]
    async fn connects_tests_and_counts_affected() {
        SqliteDriver::test(&mem_cfg()).await.unwrap();
        let d = SqliteDriver::connect(&mem_cfg()).await.unwrap();
        d.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
            .await
            .unwrap();
        let r = d
            .execute("INSERT INTO t (name) VALUES ('a'),('b')")
            .await
            .unwrap();
        assert_eq!(r.rows_affected, 2);
    }

    #[tokio::test]
    async fn introspects_tables_and_columns() {
        let d = SqliteDriver::connect(&mem_cfg()).await.unwrap();
        d.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)")
            .await
            .unwrap();
        d.execute(
            "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id))",
        )
        .await
        .unwrap();
        d.execute("CREATE VIEW v AS SELECT id FROM users")
            .await
            .unwrap();

        let tables = d.list_tables().await.unwrap();
        assert!(tables
            .iter()
            .any(|t| t.name == "users" && t.kind == "table"));
        assert!(tables.iter().any(|t| t.name == "v" && t.kind == "view"));

        let cols = d.list_columns("users").await.unwrap();
        let id = cols.iter().find(|c| c.name == "id").unwrap();
        assert!(id.is_primary_key);
        let email = cols.iter().find(|c| c.name == "email").unwrap();
        assert!(!email.nullable);

        assert!(d.list_columns("bad; DROP").await.unwrap().is_empty());

        let fks = d.list_foreign_keys().await.unwrap();
        assert_eq!(fks.len(), 1);
        assert_eq!(fks[0].table, "posts");
        assert_eq!(fks[0].column, "user_id");
        assert_eq!(fks[0].ref_table, "users");
        assert_eq!(fks[0].ref_column, "id");
    }

    #[tokio::test]
    async fn transaction_commands_share_one_session() {
        let d = SqliteDriver::connect(&mem_cfg()).await.unwrap();
        d.execute("CREATE TABLE tx_test (id INTEGER PRIMARY KEY)")
            .await
            .unwrap();
        d.execute("BEGIN").await.unwrap();
        d.execute("INSERT INTO tx_test VALUES (1)").await.unwrap();
        d.execute("ROLLBACK").await.unwrap();
        let result = d.execute("SELECT id FROM tx_test").await.unwrap();
        assert!(result.rows.is_empty());
    }
}
