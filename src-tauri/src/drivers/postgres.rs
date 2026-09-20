use async_trait::async_trait;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgSslMode};
use sqlx::{Column as _, Row, TypeInfo};
use std::collections::HashSet;
use tokio::sync::Mutex;

use crate::drivers::{expand_home_path, Driver};
use crate::error::AppResult;
use crate::executor::pg_row_to_values;
use crate::types::{Column, ColumnInfo, ConnectionConfig, ConnectionDiagnostics, ConstraintInfo, ForeignKey, IndexInfo, QueryResult, TableInfo, TlsMode, MAX_ROWS};

pub struct PgDriver {
    pool: sqlx::PgPool,
    active_pid: Mutex<Option<i32>>,
}

fn options(cfg: &ConnectionConfig, password: Option<&str>) -> PgConnectOptions {
    let options = base_options(cfg, password).database(&cfg.database);
    match cfg.schema.as_deref().map(str::trim).filter(|schema| !schema.is_empty()) {
        Some(schema) => options.options([("search_path", schema)]),
        None => options.options([("search_path", "public")]),
    }
}

/// Postgres requires connecting to *some* database; use the standard `postgres`
/// maintenance database for server-level operations (listing/creating databases).
fn maintenance_options(cfg: &ConnectionConfig, password: Option<&str>) -> PgConnectOptions {
    base_options(cfg, password).database("postgres")
}

fn base_options(cfg: &ConnectionConfig, password: Option<&str>) -> PgConnectOptions {
    let mut o = PgConnectOptions::new()
        .host(cfg.host.as_deref().unwrap_or("localhost"))
        .port(cfg.port.unwrap_or(5432));

    if let Some(u) = cfg.username.as_deref() {
        o = o.username(u);
    }
    if let Some(p) = password {
        o = o.password(p);
    }

    let tls_mode = cfg.tls.as_ref().map(|tls| tls.mode).unwrap_or(TlsMode::Disable);
    o = o.ssl_mode(match tls_mode {
        TlsMode::Disable => PgSslMode::Disable,
        TlsMode::Allow => PgSslMode::Allow,
        TlsMode::Prefer => PgSslMode::Prefer,
        TlsMode::Require => PgSslMode::Require,
        TlsMode::VerifyCa => PgSslMode::VerifyCa,
        TlsMode::VerifyFull => PgSslMode::VerifyFull,
    });

    if let Some(ca_path) = cfg
        .tls
        .as_ref()
        .and_then(|tls| tls.ca_path.as_deref())
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        o = o.ssl_root_cert(expand_home_path(ca_path));
    }

    o
}

fn sanitize_ident(name: &str) -> String {
    name.chars().filter(|c| c.is_alphanumeric() || *c == '_').collect()
}

impl PgDriver {
    pub async fn connect(cfg: &ConnectionConfig, password: Option<&str>) -> AppResult<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect_with(options(cfg, password))
            .await?;
        Ok(Self { pool, active_pid: Mutex::new(None) })
    }

    pub async fn test(cfg: &ConnectionConfig, password: Option<&str>) -> AppResult<()> {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_with(options(cfg, password))
            .await?;
        sqlx::query("SELECT 1").execute(&pool).await?;
        pool.close().await;
        Ok(())
    }

    /// Connect to the maintenance database and list every non-template database.
    pub async fn list_databases(cfg: &ConnectionConfig, password: Option<&str>) -> AppResult<Vec<String>> {
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_with(maintenance_options(cfg, password))
            .await?;
        let rows = sqlx::query(
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
        )
        .fetch_all(&pool)
        .await?;
        pool.close().await;
        Ok(rows.iter().filter_map(|r| r.try_get::<String, _>("datname").ok()).collect())
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
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_with(maintenance_options(cfg, password))
            .await?;
        sqlx::query(&format!("CREATE DATABASE \"{ident}\"")).execute(&pool).await?;
        pool.close().await;
        Ok(())
    }
}

#[async_trait]
impl Driver for PgDriver {
    async fn execute(&self, sql: &str) -> AppResult<QueryResult> {
        let started = std::time::Instant::now();
        let mut conn = self.pool.acquire().await?;
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *conn)
            .await?;
        *self.active_pid.lock().await = Some(pid);

        let result: AppResult<QueryResult> = async {
            let head = sql.trim_start().to_uppercase();
            let returns_rows = head.starts_with("SELECT")
                || head.starts_with("WITH")
                || head.starts_with("SHOW")
                || head.starts_with("TABLE")
                || head.starts_with("VALUES")
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
                rows.push(pg_row_to_values(row)?);
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

        *self.active_pid.lock().await = None;
        result
    }

    async fn cancel(&self) -> AppResult<bool> {
        let Some(pid) = *self.active_pid.lock().await else {
            return Ok(false);
        };
        let cancelled: bool = sqlx::query_scalar("SELECT pg_cancel_backend($1)")
            .bind(pid)
            .fetch_one(&self.pool)
            .await?;
        Ok(cancelled)
    }
    async fn diagnostics(&self) -> AppResult<ConnectionDiagnostics> {
        let started = std::time::Instant::now();
        let row = sqlx::query(
            "SELECT version() AS server_version, current_database() AS database, current_schema() AS schema",
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(ConnectionDiagnostics {
            server_version: row.try_get("server_version").unwrap_or_else(|_| "PostgreSQL".into()),
            database: row.try_get("database").unwrap_or_default(),
            schema: row.try_get("schema").ok(),
            latency_ms: started.elapsed().as_millis() as u64,
        })
    }

    async fn list_schemas(&self) -> AppResult<Vec<String>> {
        let rows = sqlx::query(
            "SELECT schema_name FROM information_schema.schemata
             WHERE schema_name <> 'information_schema' AND schema_name NOT LIKE 'pg_%'
             ORDER BY schema_name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .filter_map(|row| row.try_get::<String, _>("schema_name").ok())
            .collect())
    }

    async fn list_tables(&self) -> AppResult<Vec<TableInfo>> {
        let rows = sqlx::query(
            "SELECT table_name, table_type, table_schema FROM information_schema.tables \
             WHERE table_schema = current_schema() \
             ORDER BY table_name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let table_type: String = r.try_get("table_type").unwrap_or_default();
                let kind = if table_type == "VIEW" { "view" } else { "table" };
                TableInfo {
                    name: r.try_get("table_name").unwrap_or_default(),
                    kind: kind.to_string(),
                    schema: r.try_get("table_schema").ok(),
                }
            })
            .collect())
    }

    async fn list_columns(&self, table: &str) -> AppResult<Vec<ColumnInfo>> {
        let pk_rows = sqlx::query(
            "SELECT kcu.column_name FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
             WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 \
               AND tc.table_schema = current_schema()",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;
        let pks: HashSet<String> = pk_rows
            .iter()
            .filter_map(|r| r.try_get::<String, _>("column_name").ok())
            .collect();

        let rows = sqlx::query(
            "SELECT a.attname AS column_name, \
                    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type, \
                    NOT a.attnotnull AS is_nullable, \
                    CASE WHEN a.attgenerated = '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) END AS column_default, \
                    CASE WHEN a.attgenerated <> '' THEN pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) END AS generation_expression, \
                    pg_catalog.col_description(a.attrelid, a.attnum) AS column_comment, \
                    CASE a.attidentity WHEN 'a' THEN 'IDENTITY ALWAYS' WHEN 'd' THEN 'IDENTITY BY DEFAULT' ELSE NULL END AS column_extra \
             FROM pg_catalog.pg_attribute a \
             JOIN pg_catalog.pg_class cls ON cls.oid = a.attrelid \
             JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace \
             LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum \
             WHERE ns.nspname = current_schema() AND cls.relname = $1 \
               AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY a.attnum",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let name: String = r.try_get("column_name").unwrap_or_default();
                ColumnInfo {
                    is_primary_key: pks.contains(&name),
                    nullable: r.try_get::<bool, _>("is_nullable").unwrap_or(true),
                    data_type: r
                        .try_get::<String, _>("data_type")
                        .unwrap_or_else(|_| "unknown".into()),
                    default_value: r.try_get::<Option<String>, _>("column_default").ok().flatten(),
                    generated: r
                        .try_get::<Option<String>, _>("generation_expression")
                        .ok()
                        .flatten(),
                    comment: r.try_get::<Option<String>, _>("column_comment").ok().flatten(),
                    extra: r.try_get::<Option<String>, _>("column_extra").ok().flatten(),
                    name,
                }
            })
            .collect())
    }
    async fn list_foreign_keys(&self) -> AppResult<Vec<ForeignKey>> {
        let rows = sqlx::query(
            "SELECT tc.constraint_name, tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema \
             JOIN information_schema.constraint_column_usage ccu \
               ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema \
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = current_schema() \
             ORDER BY tc.table_name, kcu.ordinal_position",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| ForeignKey {
                name: row.try_get("constraint_name").ok(),
                table: row.try_get("table_name").unwrap_or_default(),
                column: row.try_get("column_name").unwrap_or_default(),
                ref_table: row.try_get("ref_table").unwrap_or_default(),
                ref_column: row.try_get("ref_column").unwrap_or_default(),
            })
            .collect())
    }

    async fn list_indexes(&self, table: &str) -> AppResult<Vec<IndexInfo>> {
        let rows = sqlx::query(
            "SELECT indexname, indexdef FROM pg_indexes \
             WHERE schemaname = current_schema() AND tablename = $1 \
             ORDER BY indexname",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let definition: String = row.try_get("indexdef").unwrap_or_default();
                IndexInfo {
                    name: row.try_get("indexname").unwrap_or_default(),
                    unique: definition.to_uppercase().contains("CREATE UNIQUE INDEX"),
                    detail: definition,
                }
            })
            .collect())
    }
    async fn list_constraints(&self, table: &str) -> AppResult<Vec<ConstraintInfo>> {
        let rows = sqlx::query(
            "SELECT con.conname, con.contype::text AS contype, pg_catalog.pg_get_constraintdef(con.oid, true) AS definition, \
                    COALESCE(string_agg(att.attname, ',' ORDER BY ord.ordinality), '') AS columns_csv \
             FROM pg_catalog.pg_constraint con \
             JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid \
             JOIN pg_catalog.pg_namespace ns ON ns.oid = rel.relnamespace \
             LEFT JOIN LATERAL unnest(con.conkey) WITH ORDINALITY ord(attnum, ordinality) ON true \
             LEFT JOIN pg_catalog.pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ord.attnum \
             WHERE ns.nspname = current_schema() AND rel.relname = $1 \
               AND con.contype IN ('p', 'u', 'c') \
             GROUP BY con.oid, con.conname, con.contype \
             ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 ELSE 2 END, con.conname",
        )
        .bind(table)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let kind = match row.try_get::<String, _>("contype").unwrap_or_default().as_str() {
                    "p" => "primary",
                    "u" => "unique",
                    _ => "check",
                };
                let columns_csv: String = row.try_get("columns_csv").unwrap_or_default();
                ConstraintInfo {
                    name: row.try_get("conname").ok(),
                    kind: kind.into(),
                    definition: row.try_get("definition").unwrap_or_default(),
                    columns: columns_csv
                        .split(',')
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                        .collect(),
                }
            })
            .collect())
    }


}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Engine;

    // Env-gated: runs only when ORBITODB_PG_TEST is set (so CI without a DB passes).
    fn pg_cfg() -> Option<(ConnectionConfig, Option<String>)> {
        std::env::var("ORBITODB_PG_TEST").ok()?;
        let cfg = ConnectionConfig {
            id: "pgtest".into(),
            name: "pg".into(),
            engine: Engine::Postgres,
            host: Some(std::env::var("ORBITODB_PG_HOST").unwrap_or_else(|_| "localhost".into())),
            port: Some(
                std::env::var("ORBITODB_PG_PORT")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(5432),
            ),
            database: std::env::var("ORBITODB_PG_DB").unwrap_or_else(|_| "postgres".into()),
            username: Some(std::env::var("ORBITODB_PG_USER").unwrap_or_else(|_| "postgres".into())),
            env: None,
            group: None,
            schema: None,
            tls: None,
            ssh: None,
        };
        Some((cfg, std::env::var("ORBITODB_PG_PASS").ok()))
    }

    #[tokio::test]
    async fn pg_integration() {
        let Some((cfg, pass)) = pg_cfg() else {
            eprintln!("skipping pg_integration (set ORBITODB_PG_TEST to run)");
            return;
        };
        PgDriver::test(&cfg, pass.as_deref()).await.unwrap();
        let d = PgDriver::connect(&cfg, pass.as_deref()).await.unwrap();

        d.execute("DROP TABLE IF EXISTS orbitodb_t").await.unwrap();
        d.execute(
            "CREATE TABLE orbitodb_t (id SERIAL PRIMARY KEY, name TEXT NOT NULL, score REAL, ts TIMESTAMP)",
        )
        .await
        .unwrap();
        let ins = d
            .execute("INSERT INTO orbitodb_t (name, score, ts) VALUES ('a', 1.5, now()), ('b', NULL, NULL)")
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

        // Editing round-trip: UPDATE via the editing builder (string-literal PK
        // '1' must coerce against the INT column), then confirm it took.
        let upd = crate::editing::build_update(
            Engine::Postgres,
            "orbitodb_t",
            "name",
            &serde_json::json!("renamed"),
            "id",
            &serde_json::json!(1),
        );
        d.execute(&upd).await.unwrap();
        let r2 = d
            .execute("SELECT name FROM orbitodb_t WHERE id = 1")
            .await
            .unwrap();
        assert_eq!(r2.rows[0][0], serde_json::json!("renamed"));

        d.execute("DROP TABLE orbitodb_t").await.unwrap();
    }
}
