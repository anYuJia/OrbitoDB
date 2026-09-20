use async_trait::async_trait;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Column as _, Row, TypeInfo};

use crate::drivers::Driver;
use crate::error::AppResult;
use crate::executor::sqlite_row_to_values;
use crate::types::{Column, ColumnInfo, ConnectionConfig, ConnectionDiagnostics, ConstraintInfo, ForeignKey, IndexInfo, QueryResult, TableInfo, MAX_ROWS};

pub struct SqliteDriver {
    pub(crate) pool: sqlx::SqlitePool,
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn sqlite_checks(create_sql: &str) -> Vec<String> {
    let upper = create_sql.to_uppercase();
    let bytes = create_sql.as_bytes();
    let mut out = Vec::new();
    let mut search_from = 0usize;

    while let Some(rel) = upper[search_from..].find("CHECK") {
        let check_at = search_from + rel;
        let Some(open_rel) = create_sql[check_at + 5..].find('(') else {
            break;
        };
        let open = check_at + 5 + open_rel;
        let mut depth = 0i32;
        let mut quote: Option<u8> = None;
        let mut close = None;
        let mut i = open;
        while i < bytes.len() {
            let ch = bytes[i];
            if let Some(q) = quote {
                if ch == q {
                    if i + 1 < bytes.len() && bytes[i + 1] == q {
                        i += 2;
                        continue;
                    }
                    quote = None;
                }
            } else if ch == b'\'' || ch == b'"' {
                quote = Some(ch);
            } else if ch == b'(' {
                depth += 1;
            } else if ch == b')' {
                depth -= 1;
                if depth == 0 {
                    close = Some(i);
                    break;
                }
            }
            i += 1;
        }
        if let Some(close) = close {
            out.push(create_sql[open + 1..close].trim().to_string());
            search_from = close + 1;
        } else {
            break;
        }
    }
    out
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
        // Single connection: `:memory:` databases are per-connection, and this
        // keeps the session behaving like one coherent SQL connection.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&sqlite_url(&cfg.database))
            .await?;
        Ok(Self { pool })
    }

    pub async fn test(cfg: &ConnectionConfig) -> AppResult<()> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&sqlite_url(&cfg.database))
            .await?;
        sqlx::query("SELECT 1").execute(&pool).await?;
        pool.close().await;
        Ok(())
    }
}

#[async_trait]
impl Driver for SqliteDriver {
    async fn execute(&self, sql: &str) -> AppResult<QueryResult> {
        let started = std::time::Instant::now();
        let head = sql.trim_start().to_uppercase();
        let returns_rows = head.starts_with("SELECT")
            || head.starts_with("PRAGMA")
            || head.starts_with("WITH")
            || head.starts_with("EXPLAIN");

        if !returns_rows {
            let res = sqlx::query(sql).execute(&self.pool).await?;
            return Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                rows_affected: res.rows_affected(),
                elapsed_ms: started.elapsed().as_millis() as u64,
                truncated: false,
            });
        }

        let fetched = sqlx::query(sql).fetch_all(&self.pool).await?;
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

    async fn cancel(&self) -> AppResult<bool> {
        // SQLx does not expose sqlite3_interrupt for pooled SQLite connections.
        // Keep this honest rather than pretending the query stopped.
        Ok(false)
    }

    async fn diagnostics(&self) -> AppResult<ConnectionDiagnostics> {
        let started = std::time::Instant::now();
        let version: String = sqlx::query_scalar("SELECT sqlite_version()")
            .fetch_one(&self.pool)
            .await?;
        let rows = sqlx::query("PRAGMA database_list")
            .fetch_all(&self.pool)
            .await?;
        let database = rows
            .iter()
            .find(|row| row.try_get::<String, _>("name").ok().as_deref() == Some("main"))
            .and_then(|row| row.try_get::<String, _>("file").ok())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "main".into());
        Ok(ConnectionDiagnostics {
            server_version: format!("SQLite {version}"),
            database,
            schema: Some("main".into()),
            latency_ms: started.elapsed().as_millis() as u64,
        })
    }

    async fn list_schemas(&self) -> AppResult<Vec<String>> {
        Ok(vec!["main".into(), "temp".into()])
    }

    async fn list_tables(&self) -> AppResult<Vec<TableInfo>> {
        let rows = sqlx::query(
            "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| TableInfo {
                name: r.try_get::<String, _>("name").unwrap_or_default(),
                kind: r.try_get::<String, _>("type").unwrap_or_else(|_| "table".into()),
                schema: None,
            })
            .collect())
    }

    async fn list_columns(&self, table: &str) -> AppResult<Vec<ColumnInfo>> {
        let rows = sqlx::query(&format!("PRAGMA table_xinfo({})", quote_ident(table)))
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .iter()
            .map(|r| {
                let hidden = r.try_get::<i64, _>("hidden").unwrap_or(0);
                ColumnInfo {
                    name: r.try_get::<String, _>("name").unwrap_or_default(),
                    data_type: r.try_get::<String, _>("type").unwrap_or_default(),
                    nullable: r.try_get::<i64, _>("notnull").unwrap_or(0) == 0,
                    is_primary_key: r.try_get::<i64, _>("pk").unwrap_or(0) > 0,
                    default_value: r.try_get::<Option<String>, _>("dflt_value").ok().flatten(),
                    generated: match hidden {
                        2 => Some("VIRTUAL (expression unavailable)".into()),
                        3 => Some("STORED (expression unavailable)".into()),
                        _ => None,
                    },
                    comment: None,
                    extra: match hidden {
                        2 => Some("VIRTUAL GENERATED".into()),
                        3 => Some("STORED GENERATED".into()),
                        _ => None,
                    },
                }
            })
            .collect())
    }
    async fn list_foreign_keys(&self) -> AppResult<Vec<ForeignKey>> {
        let mut out = Vec::new();
        for table in self.list_tables().await?.into_iter().filter(|table| table.kind == "table") {
            let rows = sqlx::query(&format!("PRAGMA foreign_key_list({})", quote_ident(&table.name)))
                .fetch_all(&self.pool)
                .await?;
            for row in rows {
                out.push(ForeignKey {
                    name: None,
                    table: table.name.clone(),
                    column: row.try_get::<String, _>("from").unwrap_or_default(),
                    ref_table: row.try_get::<String, _>("table").unwrap_or_default(),
                    ref_column: row.try_get::<String, _>("to").unwrap_or_default(),
                });
            }
        }
        Ok(out)
    }

    async fn list_indexes(&self, table: &str) -> AppResult<Vec<IndexInfo>> {
        let rows = sqlx::query(&format!("PRAGMA index_list({})", quote_ident(table)))
            .fetch_all(&self.pool)
            .await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let name = row.try_get::<String, _>("name").unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let unique = row.try_get::<i64, _>("unique").unwrap_or(0) == 1;
            let info = sqlx::query(&format!("PRAGMA index_info({})", quote_ident(&name)))
                .fetch_all(&self.pool)
                .await?;
            let columns = info
                .iter()
                .filter_map(|item| item.try_get::<String, _>("name").ok())
                .filter(|column| !column.is_empty())
                .collect::<Vec<_>>();
            let origin = row.try_get::<String, _>("origin").unwrap_or_default();
            let detail = if columns.is_empty() {
                if origin.is_empty() { "SQLite index".into() } else { format!("origin: {origin}") }
            } else if origin.is_empty() || origin == "c" {
                columns.join(", ")
            } else {
                format!("{} · origin: {}", columns.join(", "), origin)
            };
            out.push(IndexInfo { name, unique, detail });
        }
        Ok(out)
    }
    async fn list_constraints(&self, table: &str) -> AppResult<Vec<ConstraintInfo>> {
        let mut out = Vec::new();

        let pk_rows = sqlx::query(&format!("PRAGMA table_xinfo({})", quote_ident(table)))
            .fetch_all(&self.pool)
            .await?;
        let mut primary = pk_rows
            .iter()
            .filter_map(|row| {
                let ordinal = row.try_get::<i64, _>("pk").unwrap_or(0);
                if ordinal <= 0 {
                    return None;
                }
                Some((
                    ordinal,
                    row.try_get::<String, _>("name").unwrap_or_default(),
                ))
            })
            .collect::<Vec<_>>();
        primary.sort_by_key(|(ordinal, _)| *ordinal);
        let primary = primary.into_iter().map(|(_, name)| name).collect::<Vec<_>>();
        if !primary.is_empty() {
            out.push(ConstraintInfo {
                name: None,
                kind: "primary".into(),
                definition: format!("PRIMARY KEY ({})", primary.join(", ")),
                columns: primary,
            });
        }

        let indexes = sqlx::query(&format!("PRAGMA index_list({})", quote_ident(table)))
            .fetch_all(&self.pool)
            .await?;
        for row in indexes {
            let origin = row.try_get::<String, _>("origin").unwrap_or_default();
            if origin != "u" {
                continue;
            }
            let name = row.try_get::<String, _>("name").unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let info = sqlx::query(&format!("PRAGMA index_info({})", quote_ident(&name)))
                .fetch_all(&self.pool)
                .await?;
            let cols = info
                .iter()
                .filter_map(|item| item.try_get::<String, _>("name").ok())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            out.push(ConstraintInfo {
                name: None,
                kind: "unique".into(),
                definition: format!("UNIQUE ({})", cols.join(", ")),
                columns: cols,
            });
        }

        let row = sqlx::query(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(table)
        .fetch_optional(&self.pool)
        .await?;
        if let Some(row) = row {
            if let Ok(Some(sql)) = row.try_get::<Option<String>, _>("sql") {
                for expression in sqlite_checks(&sql) {
                    out.push(ConstraintInfo {
                        name: None,
                        kind: "check".into(),
                        definition: format!("CHECK ({expression})"),
                        columns: vec![],
                    });
                }
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
            group: None,
            schema: None,
            tls: None,
            ssh: None,
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
    async fn introspects_tables_columns_foreign_keys_and_indexes() {
        let d = SqliteDriver::connect(&mem_cfg()).await.unwrap();
        d.execute("CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
            .await
            .unwrap();
        d.execute(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, team_id INTEGER, email TEXT NOT NULL DEFAULT 'unknown', \
             normalized TEXT GENERATED ALWAYS AS (lower(email)) VIRTUAL, \
             FOREIGN KEY(team_id) REFERENCES teams(id))",
        )
        .await
        .unwrap();
        d.execute("CREATE UNIQUE INDEX idx_users_email ON users(email)")
            .await
            .unwrap();
        d.execute("CREATE VIEW v AS SELECT id FROM users")
            .await
            .unwrap();

        let tables = d.list_tables().await.unwrap();
        assert!(tables.iter().any(|t| t.name == "users" && t.kind == "table"));
        assert!(tables.iter().any(|t| t.name == "v" && t.kind == "view"));

        let cols = d.list_columns("users").await.unwrap();
        let id = cols.iter().find(|c| c.name == "id").unwrap();
        assert!(id.is_primary_key);
        let email = cols.iter().find(|c| c.name == "email").unwrap();
        assert!(!email.nullable);
        assert_eq!(email.default_value.as_deref(), Some("'unknown'"));
        let normalized = cols.iter().find(|c| c.name == "normalized").unwrap();
        assert_eq!(
            normalized.generated.as_deref(),
            Some("VIRTUAL (expression unavailable)")
        );

        let foreign_keys = d.list_foreign_keys().await.unwrap();
        assert!(foreign_keys.iter().any(|fk| {
            fk.table == "users"
                && fk.column == "team_id"
                && fk.ref_table == "teams"
                && fk.ref_column == "id"
        }));

        let indexes = d.list_indexes("users").await.unwrap();
        let email_index = indexes.iter().find(|index| index.name == "idx_users_email").unwrap();
        assert!(email_index.unique);
        assert!(email_index.detail.contains("email"));

        d.execute(
            "CREATE TABLE constraint_t (a INTEGER, b INTEGER, code TEXT UNIQUE, age INTEGER CHECK(age >= 0), PRIMARY KEY(b, a))",
        )
        .await
        .unwrap();
        let constraints = d.list_constraints("constraint_t").await.unwrap();
        let primary = constraints.iter().find(|item| item.kind == "primary").unwrap();
        assert_eq!(primary.columns, vec!["b".to_string(), "a".to_string()]);
        assert!(constraints.iter().any(|item| item.kind == "unique" && item.columns == vec!["code".to_string()]));
        assert!(constraints.iter().any(|item| item.kind == "check" && item.definition.contains("age >= 0")));

        // Safe quoting: an arbitrary identifier is treated as an identifier,
        // never executed as SQL.
        assert!(d.list_columns("bad; DROP").await.unwrap().is_empty());
    }
}
