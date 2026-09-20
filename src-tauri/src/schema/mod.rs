use crate::drivers::Driver;
use crate::error::AppResult;
use crate::types::{ColumnInfo, ConstraintInfo, ForeignKey, IndexInfo, TableInfo};

/// Introspection helpers the command layer calls. Thin pass-throughs today;
/// the seam for caching / cross-engine normalization later.
pub async fn introspect_tables(driver: &dyn Driver) -> AppResult<Vec<TableInfo>> {
    driver.list_tables().await
}

pub async fn introspect_columns(driver: &dyn Driver, table: &str) -> AppResult<Vec<ColumnInfo>> {
    driver.list_columns(table).await
}


pub async fn introspect_foreign_keys(driver: &dyn Driver) -> AppResult<Vec<ForeignKey>> {
    driver.list_foreign_keys().await
}

pub async fn introspect_indexes(driver: &dyn Driver, table: &str) -> AppResult<Vec<IndexInfo>> {
    driver.list_indexes(table).await
}


pub async fn introspect_constraints(driver: &dyn Driver, table: &str) -> AppResult<Vec<ConstraintInfo>> {
    driver.list_constraints(table).await
}
