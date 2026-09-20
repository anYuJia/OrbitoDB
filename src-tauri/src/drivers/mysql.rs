use async_trait::async_trait;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{Column as _, Row, TypeInfo};
use tokio::sync::Mutex;

use crate::drivers::{expand_home_path, Driver};
use crate::error::AppResult;
use crate::executor::mysql_row_to_values;
use crate::types::{Column, ColumnInfo, ConnectionConfig, ForeignKey, IndexInfo, QueryResult, TableInfo, TlsMode, MAX_ROWS};

pub struct MySqlDriver {
    pool: sqlx::MySqlPool,
    active_thread_id: Mutex<Option<u64>>,
}

fn options(cfg: &ConnectionConfig, password: Option<&str>) -> MySqlConnectOptions {
    server_options(cfg, password).database(&cfg.database)
}

/// Connect to the server without selecting a database (for listing/creating
/// databases before one has been chosen).
fn server_options(cfg: &ConnectionConfig, password: Option<&str>) -> MySqlConnectOptions {
    let mut o = MySqlConnectOptions::new()
        .host(cfg.host.as_deref().unwrap_or("localhost"))
        .port(cfg.port.unwrap_or(3306));

    if let Some(u) = cfg.username.as_deref() {
        o = o.username(u);
    }
    if let Some(p) = password {
        o = o.password(p);
    }

    let tls_mode = cfg.tls.as_ref().map(|tls| tls.mode).unwrap_or(TlsMode::Disable);
    o = o.ssl_mode(match tls_mode {
        TlsMode::Disable => MySqlSslMode::Disabled,
        TlsMode::Allow => MySqlSslMode::Preferred,
        TlsMode::Prefer => MySqlSslMode::Preferred,
        TlsMode::Require => MySqlSslMode::Required,
        TlsMode::VerifyCa => MySqlSslMode::VerifyCa,
        TlsMode::VerifyFull => MySqlSslMode::VerifyIdentity,
    });

    if let Some(ca_path) = cfg
        .tls
        .as_ref()
        .and_then(|tls| tls.ca_path.as_deref())
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        o = o.ssl_ca(expand_home_path(ca_path));
    }

    o
}

/// Keep only identifier-safe characters so a database name can be interpolated
/// into DDL without injection risk.
fn sanitize_ident(name: &str) -> String {
    name.chars().filter(|c| c.is_alphanumeric() || *c == '_').collect()
}

/// information_schema text columns can come back as utf8 strings OR as binary
/// (varbinary/blob) depending on MySQL/MariaDB version + collation. Decode
/// defensively so introspection never panics (a panic would hang the command).
fn try_get_text(row: &sqlx::mysql::MySqlRow, col: &str) -> String {
    if let Ok(s) = row.try_get::<String, _>(col) {
        return s;
    }
    if let Ok(b) = row.try_get::<Vec<u8>, _>(col) {
        return String::from_utf8_lossy(&b).into_owned();
    }
    String::new()
}

impl MySqlDriver {
    pub async fn connect(cfg: &ConnectionConfig, password: Option<&str>) -> AppResult<Self> {
        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .connect_with(options(cfg, password))
            .await?;
        Ok(Self { pool, active_thread_id: Mutex::new(None) })
    }

    pub async fn test(cfg: &ConnectionConfig, password: Option<&str>) -> AppResult<()> {
        let pool = MySqlPoolOptions::new()
            .max_connections(1)
            .connect_with(options(cfg, password))
            .await?;
        sqlx::query("SELECT 1").execute(&pool).await?;
        pool.close().await;
        Ok(())
    }

    /// Connect at the server level and return every database name.
    pub async fn list_databases(cfg: &ConnectionConfig, password: Option<&str>) -> AppResult<Vec<String>> {
        let pool = MySqlPoolOptions::new()
            .max_connections(1)
            .connect_with(server_options(cfg, password))
            .await?;
        let rows = sqlx::query("SHOW DATABASES").fetch_all(&pool).await?;
        pool.close().await;
        Ok(rows.iter().map(|r| try_get_text(r, "Database")).collect())
    }

    pub async fn create_database(
        cfg: &ConnectionConfig,
        password: Option<&str>,
        name: &str,
    ) -> AppResult<()> {
        let ident = sanitize_ident(name);
        if ident.is_empty() {
            return Err(crate::error::AppError::Internal("invalid database name".into()));
        }
        let pool = MySqlPoolOptions::new()
            .max_connections(1)
            .connect_with(server_options(cfg, password))
            .await?;
        sqlx::query(&format!("CREATE DATABASE `{ident}`")).execute(&pool).await?;
        pool.close().await;
        Ok(())
    }
}

#[async_trait]
impl Driver for MySqlDriver {
    async fn execute(&self, sql: &str) -> AppResult<QueryResult> {
        let started = std::time::Instant::now();
        let mut conn = self.pool.acquire().await?;
        let thread_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()")
            .fetch_one(&mut *conn)
            .await?;
        *self.active_thread_id.lock().await = Some(thread_id);

        let result: AppResult<QueryResult> = async {
            let head = sql.trim_start().to_uppercase();
            let returns_rows = head.starts_with("SELECT")
                || head.starts_with("WITH")
                || head.starts_with("SHOW")
                || head.starts_with("DESCRIBE")
                || head.starts_with("DESC ")
                || head.starts_with("EXPLAIN")
                || head.starts_with("VALUES");

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
                rows.push(mysql_row_to_values(row)?);
            }
            Ok(QueryResult {
                columns,
                rows,
                rows_affected: 0,
                elapsed_ms: started.elapsed().as_millis() as u64,
                truncated,
            })
        }
        .await;

        *self.active_thread_id.lock().await = None;
        result
    }

    async fn cancel(&self) -> AppResult<bool> {
        let Some(thread_id) = *self.active_thread_id.lock().await else {
            return Ok(false);
        };
        sqlx::query(&format!("KILL QUERY {thread_id}"))
            .execute(&self.pool)
            .await?;
        Ok(true)
    }
    async fn list_schemas(&self) -> AppResult<Vec<String>> {
        let row = sqlx::query("SELECT database() AS schema_name")
            .fetch_one(&self.pool)
            .await?;
        let name = try_get_text(&row, "schema_name");
        Ok(if name.is_empty() { vec![] } else { vec![name] })
    }

    async fn list_tables(&self) -> AppResult<Vec<TableInfo>> {
        let rows = sqlx::query(
            "SELECT table_name, table_type FROM information_schema.tables \
             WHERE table_schema = DATABASE() ORDER BY table_name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let table_type: String = try_get_text(r, "table_type");
                let kind = if table_type == "VIEW" { "view" } else { "table" };
                TableInfo {
                    name: try_get_text(r, "table_name"),
                    kind: kind.to_string(),
                    schema: None,
                }
            })
            .collect())
    }

    async fn list_columns(&self, table: &str) -> AppResult<Vec<ColumnInfo>> {
        let rows = sqlx::query(
            "SELECT column_name, data_type, is_nullable, column_key \
             FROM information_schema.columns \
             WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let name = try_get_text(r, "column_name");
                ColumnInfo {
                    is_primary_key: try_get_text(r, "column_key") == "PRI",
                    nullable: try_get_text(r, "is_nullable") == "YES",
                    data_type: try_get_text(r, "data_type"),
                    name,
                }
            })
            .collect())
    }

    async fn list_foreign_keys(&self) -> AppResult<Vec<ForeignKey>> {
        let rows = sqlx::query(
            "SELECT constraint_name, table_name, column_name, referenced_table_name, referenced_column_name \
             FROM information_schema.key_column_usage \
             WHERE referenced_table_name IS NOT NULL AND table_schema = database() \
             ORDER BY table_name, ordinal_position",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| ForeignKey {
                name: Some(try_get_text(row, "constraint_name")).filter(|name| !name.is_empty()),
                table: try_get_text(row, "table_name"),
                column: try_get_text(row, "column_name"),
                ref_table: try_get_text(row, "referenced_table_name"),
                ref_column: try_get_text(row, "referenced_column_name"),
            })
            .collect())
    }

    async fn list_indexes(&self, table: &str) -> AppResult<Vec<IndexInfo>> {
        use std::collections::BTreeMap;

        let rows = sqlx::query(
            "SELECT index_name, non_unique, column_name, seq_in_index \
             FROM information_schema.statistics \
             WHERE table_schema = database() AND table_name = ? \
             ORDER BY index_name, seq_in_index",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;

        let mut grouped: BTreeMap<String, (bool, Vec<String>)> = BTreeMap::new();
        for row in rows {
            let name = try_get_text(&row, "index_name");
            if name.is_empty() {
                continue;
            }
            let unique = row.try_get::<i64, _>("non_unique").unwrap_or(1) == 0;
            let column = try_get_text(&row, "column_name");
            let entry = grouped.entry(name).or_insert((unique, Vec::new()));
            if !column.is_empty() {
                entry.1.push(column);
            }
        }

        Ok(grouped
            .into_iter()
            .map(|(name, (unique, columns))| IndexInfo {
                name,
                unique,
                detail: if columns.is_empty() {
                    "MySQL index".into()
                } else {
                    columns.join(", ")
                },
            })
            .collect())
    }

}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Engine;

    fn my_cfg() -> Option<(ConnectionConfig, Option<String>)> {
        std::env::var("ORBITODB_MYSQL_TEST").ok()?;
        let cfg = ConnectionConfig {
            id: "mytest".into(),
            name: "my".into(),
            engine: Engine::MySql,
            host: Some(std::env::var("ORBITODB_MYSQL_HOST").unwrap_or_else(|_| "localhost".into())),
            port: Some(
                std::env::var("ORBITODB_MYSQL_PORT")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(3306),
            ),
            database: std::env::var("ORBITODB_MYSQL_DB").unwrap_or_else(|_| "orbitodb_test".into()),
            username: Some(std::env::var("ORBITODB_MYSQL_USER").unwrap_or_else(|_| "root".into())),
            env: None,
            group: None,
            schema: None,
            tls: None,
            ssh: None,
        };
        Some((cfg, std::env::var("ORBITODB_MYSQL_PASS").ok()))
    }

    #[tokio::test]
    async fn mysql_integration() {
        let Some((cfg, pass)) = my_cfg() else {
            eprintln!("skipping mysql_integration (set ORBITODB_MYSQL_TEST to run)");
            return;
        };
        MySqlDriver::test(&cfg, pass.as_deref()).await.unwrap();
        let d = MySqlDriver::connect(&cfg, pass.as_deref()).await.unwrap();

        d.execute("DROP TABLE IF EXISTS orbitodb_t").await.unwrap();
        d.execute(
            "CREATE TABLE orbitodb_t (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, score DOUBLE)",
        )
        .await
        .unwrap();
        let ins = d
            .execute("INSERT INTO orbitodb_t (name, score) VALUES ('a', 1.5), ('b', NULL)")
            .await
            .unwrap();
        assert_eq!(ins.rows_affected, 2);

        let r = d
            .execute("SELECT id, name, score FROM orbitodb_t ORDER BY id")
            .await
            .unwrap();
        assert_eq!(
            r.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
            vec!["id", "name", "score"]
        );
        assert_eq!(r.rows.len(), 2);
        assert_eq!(r.rows[0][1], serde_json::json!("a"));
        assert_eq!(r.rows[1][2], serde_json::Value::Null);

        let tables = d.list_tables().await.unwrap();
        assert!(tables.iter().any(|t| t.name == "orbitodb_t"));
        let cols = d.list_columns("orbitodb_t").await.unwrap();
        assert!(cols.iter().find(|c| c.name == "id").unwrap().is_primary_key);

        d.execute("DROP TABLE orbitodb_t").await.unwrap();
    }
}
