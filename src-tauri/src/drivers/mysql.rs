use async_trait::async_trait;
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{Column as _, Row, TypeInfo};
use tokio::sync::Mutex;

use crate::drivers::{expand_home_path, Driver};
use crate::error::AppResult;
use crate::executor::mysql_row_to_values;
use crate::types::{Column, ColumnInfo, ConnectionConfig, ConnectionDiagnostics, ConstraintInfo, DatabaseObjectInfo, ForeignKey, IndexInfo, QueryResult, TableInfo, TlsMode, MAX_ROWS};

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

fn quote_ident(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
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

fn try_get_optional_text(row: &sqlx::mysql::MySqlRow, col: &str) -> Option<String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(col) {
        return value;
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(col) {
        return value.map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
    }
    None
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
    async fn diagnostics(&self) -> AppResult<ConnectionDiagnostics> {
        let started = std::time::Instant::now();
        let row = sqlx::query("SELECT VERSION() AS server_version, DATABASE() AS database")
            .fetch_one(&self.pool)
            .await?;
        let database = try_get_text(&row, "database");
        Ok(ConnectionDiagnostics {
            server_version: try_get_text(&row, "server_version"),
            database: database.clone(),
            schema: if database.is_empty() { None } else { Some(database) },
            latency_ms: started.elapsed().as_millis() as u64,
        })
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

    async fn list_database_objects(&self) -> AppResult<Vec<DatabaseObjectInfo>> {
        let mut out = Vec::new();

        let views = sqlx::query(
            "SELECT table_name FROM information_schema.views \
             WHERE table_schema = DATABASE() ORDER BY table_name",
        )
        .fetch_all(&self.pool)
        .await?;
        for row in views {
            let name = try_get_text(&row, "table_name");
            if name.is_empty() {
                continue;
            }
            let definition = match sqlx::query(&format!("SHOW CREATE VIEW {}", quote_ident(&name)))
                .fetch_optional(&self.pool)
                .await
            {
                Ok(Some(show)) => {
                    let value = try_get_text(&show, "Create View");
                    if value.is_empty() { None } else { Some(value.trim_end_matches(';').to_string() + ";") }
                }
                _ => None,
            };
            out.push(DatabaseObjectInfo {
                name,
                kind: "view".into(),
                schema: None,
                table: None,
                signature: None,
                definition,
            });
        }

        for table in self.list_tables().await?.into_iter().filter(|item| item.kind == "table") {
            for index in self.list_indexes(&table.name).await? {
                let definition = if index.name == "PRIMARY" || index.detail == "MySQL index" {
                    None
                } else {
                    let columns = index
                        .detail
                        .split(',')
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(quote_ident)
                        .collect::<Vec<_>>();
                    if columns.is_empty() {
                        None
                    } else {
                        Some(format!(
                            "CREATE {}INDEX {} ON {} ({});",
                            if index.unique { "UNIQUE " } else { "" },
                            quote_ident(&index.name),
                            quote_ident(&table.name),
                            columns.join(", ")
                        ))
                    }
                };
                out.push(DatabaseObjectInfo {
                    name: index.name,
                    kind: "index".into(),
                    schema: None,
                    table: Some(table.name.clone()),
                    signature: None,
                    definition,
                });
            }
        }

        let routines = sqlx::query(
            "SELECT routine_name, routine_type FROM information_schema.routines \
             WHERE routine_schema = DATABASE() ORDER BY routine_type, routine_name",
        )
        .fetch_all(&self.pool)
        .await?;
        for row in routines {
            let name = try_get_text(&row, "routine_name");
            let routine_type = try_get_text(&row, "routine_type");
            if name.is_empty() {
                continue;
            }
            let is_procedure = routine_type.eq_ignore_ascii_case("PROCEDURE");
            let show_sql = format!(
                "SHOW CREATE {} {}",
                if is_procedure { "PROCEDURE" } else { "FUNCTION" },
                quote_ident(&name)
            );
            let definition = match sqlx::query(&show_sql).fetch_optional(&self.pool).await {
                Ok(Some(show)) => {
                    let key = if is_procedure { "Create Procedure" } else { "Create Function" };
                    let value = try_get_text(&show, key);
                    if value.is_empty() { None } else { Some(value.trim_end_matches(';').to_string() + ";") }
                }
                _ => None,
            };
            out.push(DatabaseObjectInfo {
                name,
                kind: if is_procedure { "procedure".into() } else { "function".into() },
                schema: None,
                table: None,
                signature: None,
                definition,
            });
        }

        let triggers = sqlx::query(
            "SELECT trigger_name, event_object_table, action_timing, event_manipulation, action_statement \
             FROM information_schema.triggers \
             WHERE trigger_schema = DATABASE() ORDER BY event_object_table, trigger_name",
        )
        .fetch_all(&self.pool)
        .await?;
        for row in triggers {
            let name = try_get_text(&row, "trigger_name");
            let table = try_get_text(&row, "event_object_table");
            let timing = try_get_text(&row, "action_timing");
            let event = try_get_text(&row, "event_manipulation");
            let statement = try_get_text(&row, "action_statement");
            let definition = if name.is_empty() || table.is_empty() || timing.is_empty() || event.is_empty() || statement.is_empty() {
                None
            } else {
                Some(format!(
                    "CREATE TRIGGER {} {} {} ON {} FOR EACH ROW {};",
                    quote_ident(&name),
                    timing,
                    event,
                    quote_ident(&table),
                    statement.trim_end_matches(';')
                ))
            };
            out.push(DatabaseObjectInfo {
                name,
                kind: "trigger".into(),
                schema: None,
                table: if table.is_empty() { None } else { Some(table) },
                signature: None,
                definition,
            });
        }

        Ok(out)
    }

    async fn list_columns(&self, table: &str) -> AppResult<Vec<ColumnInfo>> {
        let rows = sqlx::query(
            "SELECT column_name, column_type, is_nullable, column_key, column_default, \
                    generation_expression, column_comment, extra \
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
                    data_type: try_get_text(r, "column_type"),
                    default_value: try_get_optional_text(r, "column_default"),
                    generated: try_get_optional_text(r, "generation_expression")
                        .filter(|value| !value.trim().is_empty()),
                    comment: try_get_optional_text(r, "column_comment")
                        .filter(|value| !value.is_empty()),
                    extra: try_get_optional_text(r, "extra").filter(|value| !value.is_empty()),
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
    async fn list_constraints(&self, table: &str) -> AppResult<Vec<ConstraintInfo>> {
        let rows = sqlx::query(
            "SELECT tc.constraint_name, tc.constraint_type, \
                    GROUP_CONCAT(kcu.column_name ORDER BY kcu.ordinal_position SEPARATOR ',') AS columns_csv \
             FROM information_schema.table_constraints tc \
             LEFT JOIN information_schema.key_column_usage kcu \
               ON kcu.constraint_schema = tc.constraint_schema \
              AND kcu.table_name = tc.table_name \
              AND kcu.constraint_name = tc.constraint_name \
             WHERE tc.table_schema = DATABASE() AND tc.table_name = ? \
               AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE') \
             GROUP BY tc.constraint_name, tc.constraint_type \
             ORDER BY CASE tc.constraint_type WHEN 'PRIMARY KEY' THEN 0 ELSE 1 END, tc.constraint_name",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;

        let mut out = rows
            .iter()
            .map(|row| {
                let kind = if try_get_text(row, "constraint_type") == "PRIMARY KEY" {
                    "primary"
                } else {
                    "unique"
                };
                let columns_csv = try_get_text(row, "columns_csv");
                let columns = columns_csv
                    .split(',')
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                let definition = if kind == "primary" {
                    format!("PRIMARY KEY ({})", columns.join(", "))
                } else {
                    format!("UNIQUE ({})", columns.join(", "))
                };
                ConstraintInfo {
                    name: Some(try_get_text(row, "constraint_name")).filter(|name| !name.is_empty()),
                    kind: kind.into(),
                    definition,
                    columns,
                }
            })
            .collect::<Vec<_>>();

        // CHECK_CONSTRAINTS is available on modern MySQL and MariaDB. Older
        // servers may not expose it; primary/unique metadata should still work.
        if let Ok(checks) = sqlx::query(
            "SELECT tc.constraint_name, cc.check_clause \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.check_constraints cc \
               ON cc.constraint_schema = tc.constraint_schema \
              AND cc.constraint_name = tc.constraint_name \
             WHERE tc.table_schema = DATABASE() AND tc.table_name = ? \
               AND tc.constraint_type = 'CHECK' \
             ORDER BY tc.constraint_name",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await
        {
            out.extend(checks.iter().map(|row| {
                let clause = try_get_text(row, "check_clause");
                ConstraintInfo {
                    name: Some(try_get_text(row, "constraint_name")).filter(|name| !name.is_empty()),
                    kind: "check".into(),
                    definition: if clause.is_empty() { "CHECK".into() } else { format!("CHECK ({clause})") },
                    columns: vec![],
                }
            }));
        }

        Ok(out)
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
