pub mod mysql;
pub mod postgres;
pub mod sqlite;

use crate::error::AppResult;
use crate::types::{ColumnInfo, ConnectionDiagnostics, ConstraintInfo, ForeignKey, IndexInfo, QueryResult, TableInfo};
use async_trait::async_trait;

/// The seam every database engine plugs into. SQLite is implemented here;
/// Postgres and MySQL arrive in Plan 3 as additional impls of this trait.
#[async_trait]
pub trait Driver: Send + Sync {
    /// Run a statement. SELECT-like statements return columns + rows;
    /// others return `rows_affected`.
    async fn execute(&self, sql: &str) -> AppResult<QueryResult>;
    /// Cancel the currently executing user query when the engine supports it.
    /// Returns false when there is no active query or cancellation is unsupported.
    async fn cancel(&self) -> AppResult<bool>;
    /// Return live server/session information for the active connection.
    async fn diagnostics(&self) -> AppResult<ConnectionDiagnostics>;
    /// List schemas/namespaces available to the active connection.
    async fn list_schemas(&self) -> AppResult<Vec<String>>;
    /// List tables and views.
    async fn list_tables(&self) -> AppResult<Vec<TableInfo>>;
    /// List columns of a table.
    async fn list_columns(&self, table: &str) -> AppResult<Vec<ColumnInfo>>;
    /// List foreign-key relationships visible in the active database/schema.
    async fn list_foreign_keys(&self) -> AppResult<Vec<ForeignKey>>;
    /// List indexes for one table.
    async fn list_indexes(&self, table: &str) -> AppResult<Vec<IndexInfo>>;
    /// List primary/unique/check constraints defined on a table.
    async fn list_constraints(&self, table: &str) -> AppResult<Vec<ConstraintInfo>>;
}


pub(crate) fn expand_home_path(path: &str) -> std::path::PathBuf {
    if path == "~" || path.starts_with("~/") || path.starts_with("~\\") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            let suffix = path
                .trim_start_matches('~')
                .trim_start_matches(|ch| ch == '/' || ch == '\\');
            return std::path::PathBuf::from(home).join(suffix);
        }
    }
    std::path::PathBuf::from(path)
}
