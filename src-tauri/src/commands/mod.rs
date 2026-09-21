use crate::connections::ConnectionRegistry;
use crate::error::{AppError, AppResult};
use crate::schema;
use crate::secrets;
use crate::store::{HistoryEntry, Store};
use crate::types::{BackupInfo, ColumnDef, ColumnInfo, ConnectionConfig, ConnectionDiagnostics, ConstraintInfo, DatabaseObjectInfo, Engine, ForeignKey, IndexInfo, QueryResult, TableInfo};
use tauri::State;

/// Shared application state, managed by Tauri and injected into commands.
pub struct AppState {
    pub registry: ConnectionRegistry,
    pub store: Store,
}

/// Split rows into fixed-size chunks for streamed emission (consumed by the
/// frontend grid in Plan 2). `size == 0` yields a single chunk.
pub fn chunk_rows(rows: &[Vec<serde_json::Value>], size: usize) -> Vec<&[Vec<serde_json::Value>]> {
    if size == 0 {
        return vec![rows];
    }
    rows.chunks(size).collect()
}

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> AppResult<Vec<ConnectionConfig>> {
    state.store.list_connections().await
}

#[tauri::command]
pub async fn save_connection(
    state: State<'_, AppState>,
    cfg: ConnectionConfig,
    password: Option<String>,
) -> AppResult<()> {
    state.store.upsert_connection(&cfg).await?;
    if let Some(pw) = password {
        secrets::set_password(&cfg.id, &pw)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.store.delete_connection(&id).await?;
    secrets::delete_password(&id)?;
    state.registry.close(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    _state: State<'_, AppState>,
    cfg: ConnectionConfig,
    password: Option<String>,
) -> AppResult<()> {
    let password = match password {
        Some(pw) => Some(pw),
        None => secrets::get_password(&cfg.id)?,
    };
    let (effective, tunnel) = crate::connections::prepare_connection(&cfg).await?;
    let result = match effective.engine {
        Engine::Sqlite => crate::drivers::sqlite::SqliteDriver::test(&effective).await,
        Engine::Postgres => crate::drivers::postgres::PgDriver::test(&effective, password.as_deref()).await,
        Engine::MySql => crate::drivers::mysql::MySqlDriver::test(&effective, password.as_deref()).await,
    };
    crate::connections::stop_tunnel(tunnel).await;
    result
}

/// List the databases available on a server (without a database selected yet).
/// Doubles as a reachability/credentials check for the Add-source flow.
#[tauri::command]
pub async fn list_databases(
    _state: State<'_, AppState>,
    cfg: ConnectionConfig,
    password: Option<String>,
) -> AppResult<Vec<String>> {
    let password = match password {
        Some(pw) => Some(pw),
        None => secrets::get_password(&cfg.id)?,
    };
    let (effective, tunnel) = crate::connections::prepare_connection(&cfg).await?;
    let result = match effective.engine {
        Engine::Sqlite => Ok(vec![]),
        Engine::Postgres => crate::drivers::postgres::PgDriver::list_databases(&effective, password.as_deref()).await,
        Engine::MySql => crate::drivers::mysql::MySqlDriver::list_databases(&effective, password.as_deref()).await,
    };
    crate::connections::stop_tunnel(tunnel).await;
    result
}

/// Create a new database on the server.
#[tauri::command]
pub async fn create_database(
    _state: State<'_, AppState>,
    cfg: ConnectionConfig,
    password: Option<String>,
    name: String,
) -> AppResult<()> {
    let password = match password {
        Some(pw) => Some(pw),
        None => secrets::get_password(&cfg.id)?,
    };
    let (effective, tunnel) = crate::connections::prepare_connection(&cfg).await?;
    let result = match effective.engine {
        Engine::Sqlite => Err(AppError::Internal("SQLite has no server databases".into())),
        Engine::Postgres => crate::drivers::postgres::PgDriver::create_database(&effective, password.as_deref(), &name).await,
        Engine::MySql => crate::drivers::mysql::MySqlDriver::create_database(&effective, password.as_deref(), &name).await,
    };
    crate::connections::stop_tunnel(tunnel).await;
    result
}

#[tauri::command]
pub async fn open_connection(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conns = state.store.list_connections().await?;
    let cfg = conns
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::NotFound(format!("no saved connection: {id}")))?;
    let pw = secrets::get_password(&id)?;
    state.registry.open(&cfg, pw.as_deref()).await
}

#[tauri::command]
pub async fn close_connection(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.registry.close(&id).await;
    Ok(())
}

#[tauri::command]
pub async fn run_query(
    state: State<'_, AppState>,
    connection_id: String,
    sql: String,
) -> AppResult<QueryResult> {
    let driver = state.registry.get(&connection_id).await?;
    let result = driver.execute(&sql).await?;
    // History failure must never fail the query itself.
    let _ = state.store.add_history(&connection_id, &sql).await;
    Ok(result)
}

#[tauri::command]
pub async fn run_query_silent(
    state: State<'_, AppState>,
    connection_id: String,
    sql: String,
) -> AppResult<QueryResult> {
    let driver = state.registry.get(&connection_id).await?;
    driver.execute(&sql).await
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<bool> {
    let driver = state.registry.get(&connection_id).await?;
    driver.cancel().await
}

#[tauri::command]
pub async fn connection_diagnostics(
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<ConnectionDiagnostics> {
    let driver = state.registry.get(&connection_id).await?;
    driver.diagnostics().await
}


fn safe_backup_key(value: &str) -> String {
    let safe: String = value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .collect();
    if safe.is_empty() { "connection".into() } else { safe }
}

fn backup_directory(app: &tauri::AppHandle, connection_id: &str) -> AppResult<std::path::PathBuf> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Internal(error.to_string()))?
        .join("backups")
        .join(safe_backup_key(connection_id));
    std::fs::create_dir_all(&dir).map_err(|error| AppError::Internal(error.to_string()))?;
    Ok(dir)
}

fn backup_info(path: &std::path::Path) -> AppResult<BackupInfo> {
    let metadata = std::fs::metadata(path).map_err(|error| AppError::Internal(error.to_string()))?;
    let modified = metadata
        .modified()
        .ok()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .unwrap_or_else(chrono::Utc::now);
    Ok(BackupInfo {
        id: path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        created_at: modified.to_rfc3339(),
        size_bytes: metadata.len(),
        path: Some(path.to_string_lossy().into_owned()),
    })
}

async fn saved_connection(state: &State<'_, AppState>, id: &str) -> AppResult<ConnectionConfig> {
    state
        .store
        .list_connections()
        .await?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound(format!("no saved connection: {id}")))
}

async fn vacuum_backup(
    state: &State<'_, AppState>,
    cfg: &ConnectionConfig,
    destination: &std::path::Path,
) -> AppResult<()> {
    let driver = match state.registry.get(&cfg.id).await {
        Ok(driver) => driver,
        Err(_) => {
            state.registry.open(cfg, None).await?;
            state.registry.get(&cfg.id).await?
        }
    };
    let escaped = destination.to_string_lossy().replace(char::from(39), "''");
    driver.execute(&format!("VACUUM INTO '{escaped}'")).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_backups(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<Vec<BackupInfo>> {
    let cfg = saved_connection(&state, &connection_id).await?;
    if cfg.engine != Engine::Sqlite {
        return Err(AppError::Internal("Managed snapshots are available for SQLite connections only".into()));
    }
    let dir = backup_directory(&app, &connection_id)?;
    let mut backups = std::fs::read_dir(&dir)
        .map_err(|error| AppError::Internal(error.to_string()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("sqlite"))
        .filter_map(|path| backup_info(&path).ok())
        .collect::<Vec<_>>();
    backups.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(backups)
}

#[tauri::command]
pub async fn create_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<BackupInfo> {
    let cfg = saved_connection(&state, &connection_id).await?;
    if cfg.engine != Engine::Sqlite {
        return Err(AppError::Internal("Managed snapshots are available for SQLite connections only".into()));
    }
    if cfg.database.trim() == ":memory:" {
        return Err(AppError::Internal("In-memory SQLite databases cannot be snapshotted to managed storage".into()));
    }
    let dir = backup_directory(&app, &connection_id)?;
    let id = format!("{}.sqlite", chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ"));
    let destination = dir.join(id);
    vacuum_backup(&state, &cfg, &destination).await?;
    backup_info(&destination)
}

#[tauri::command]
pub async fn restore_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
    backup_id: String,
) -> AppResult<()> {
    let cfg = saved_connection(&state, &connection_id).await?;
    if cfg.engine != Engine::Sqlite {
        return Err(AppError::Internal("Managed restore is available for SQLite connections only".into()));
    }
    if cfg.database.trim() == ":memory:" {
        return Err(AppError::Internal("In-memory SQLite databases cannot be restored from managed storage".into()));
    }
    if backup_id.contains('/') || backup_id.contains('\\') || !backup_id.ends_with(".sqlite") {
        return Err(AppError::Internal("Invalid backup id".into()));
    }

    let dir = backup_directory(&app, &connection_id)?;
    let source = dir.join(&backup_id);
    if !source.is_file() {
        return Err(AppError::NotFound(format!("backup not found: {backup_id}")));
    }

    let safety = dir.join(format!(
        "before-restore-{}.sqlite",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ")
    ));
    vacuum_backup(&state, &cfg, &safety).await?;

    state.registry.close(&connection_id).await;
    let target = std::path::PathBuf::from(&cfg.database);
    let copy_result = std::fs::copy(&source, &target)
        .map(|_| ())
        .map_err(|error| AppError::Internal(format!("restore failed: {error}")));
    if let Err(error) = copy_result {
        let _ = state.registry.open(&cfg, None).await;
        return Err(error);
    }

    state.registry.open(&cfg, None).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_schemas(
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<Vec<String>> {
    let driver = state.registry.get(&connection_id).await?;
    driver.list_schemas().await
}

#[tauri::command]
pub async fn list_tables(
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<Vec<TableInfo>> {
    let driver = state.registry.get(&connection_id).await?;
    schema::introspect_tables(driver.as_ref()).await
}

#[tauri::command]
pub async fn list_database_objects(
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<Vec<DatabaseObjectInfo>> {
    let driver = state.registry.get(&connection_id).await?;
    schema::introspect_database_objects(driver.as_ref()).await
}

#[tauri::command]
pub async fn list_columns(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
) -> AppResult<Vec<ColumnInfo>> {
    let driver = state.registry.get(&connection_id).await?;
    schema::introspect_columns(driver.as_ref(), &table).await
}

#[tauri::command]
pub async fn list_foreign_keys(
    state: State<'_, AppState>,
    connection_id: String,
) -> AppResult<Vec<ForeignKey>> {
    let driver = state.registry.get(&connection_id).await?;
    schema::introspect_foreign_keys(driver.as_ref()).await
}

#[tauri::command]
pub async fn list_indexes(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
) -> AppResult<Vec<IndexInfo>> {
    let driver = state.registry.get(&connection_id).await?;
    schema::introspect_indexes(driver.as_ref(), &table).await
}

#[tauri::command]
pub async fn list_constraints(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
) -> AppResult<Vec<ConstraintInfo>> {
    let driver = state.registry.get(&connection_id).await?;
    schema::introspect_constraints(driver.as_ref(), &table).await
}

#[tauri::command]
pub async fn recent_history(
    state: State<'_, AppState>,
    limit: i64,
) -> AppResult<Vec<HistoryEntry>> {
    state.store.recent_history(limit).await
}

async fn engine_of(store: &Store, connection_id: &str) -> AppResult<Engine> {
    store
        .list_connections()
        .await?
        .into_iter()
        .find(|c| c.id == connection_id)
        .map(|c| c.engine)
        .ok_or_else(|| AppError::NotFound(format!("no saved connection: {connection_id}")))
}

#[tauri::command]
pub async fn update_cell(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
    pk_column: String,
    pk_value: serde_json::Value,
    column: String,
    value: serde_json::Value,
) -> AppResult<()> {
    let engine = engine_of(&state.store, &connection_id).await?;
    let driver = state.registry.get(&connection_id).await?;
    let sql = crate::editing::build_update(engine, &table, &column, &value, &pk_column, &pk_value);
    driver.execute(&sql).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_row(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
    pk_column: String,
    pk_value: serde_json::Value,
) -> AppResult<()> {
    let engine = engine_of(&state.store, &connection_id).await?;
    let driver = state.registry.get(&connection_id).await?;
    let sql = crate::editing::build_delete(engine, &table, &pk_column, &pk_value);
    driver.execute(&sql).await?;
    Ok(())
}

#[tauri::command]
pub async fn insert_row(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
    columns: Vec<String>,
    values: Vec<serde_json::Value>,
) -> AppResult<()> {
    let engine = engine_of(&state.store, &connection_id).await?;
    let driver = state.registry.get(&connection_id).await?;
    let sql = crate::editing::build_insert(engine, &table, &columns, &values);
    driver.execute(&sql).await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_table(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
) -> AppResult<()> {
    let engine = engine_of(&state.store, &connection_id).await?;
    let driver = state.registry.get(&connection_id).await?;
    driver
        .execute(&crate::editing::build_drop_table(engine, &table))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn create_table(
    state: State<'_, AppState>,
    connection_id: String,
    name: String,
    columns: Vec<ColumnDef>,
) -> AppResult<()> {
    let engine = engine_of(&state.store, &connection_id).await?;
    let driver = state.registry.get(&connection_id).await?;
    driver
        .execute(&crate::editing::build_create_table(engine, &name, &columns))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn add_column(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
    column: ColumnDef,
) -> AppResult<()> {
    let engine = engine_of(&state.store, &connection_id).await?;
    let driver = state.registry.get(&connection_id).await?;
    driver
        .execute(&crate::editing::build_add_column(engine, &table, &column))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn drop_column(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
    column: String,
) -> AppResult<()> {
    let engine = engine_of(&state.store, &connection_id).await?;
    let driver = state.registry.get(&connection_id).await?;
    driver
        .execute(&crate::editing::build_drop_column(engine, &table, &column))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn rename_column(
    state: State<'_, AppState>,
    connection_id: String,
    table: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let engine = engine_of(&state.store, &connection_id).await?;
    let driver = state.registry.get(&connection_id).await?;
    driver
        .execute(&crate::editing::build_rename_column(engine, &table, &from, &to))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn rename_table(
    state: State<'_, AppState>,
    connection_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let engine = engine_of(&state.store, &connection_id).await?;
    let driver = state.registry.get(&connection_id).await?;
    driver
        .execute(&crate::editing::build_rename_table(engine, &from, &to))
        .await?;
    Ok(())
}

/// One-click local engine: create a fresh SQLite database file in the app data
/// dir and save it as a connection.
#[tauri::command]
pub async fn create_local_database(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> AppResult<ConnectionConfig> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .join("databases");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Internal(e.to_string()))?;
    let safe: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    let stem = if safe.is_empty() { "database".to_string() } else { safe };
    let path = dir
        .join(format!("{stem}.sqlite"))
        .to_str()
        .ok_or_else(|| AppError::Internal("invalid path".into()))?
        .to_string();
    let cfg = ConnectionConfig {
        id: format!("local-{stem}"),
        name: if name.trim().is_empty() { "Local DB".into() } else { name },
        engine: Engine::Sqlite,
        host: None,
        port: None,
        database: path,
        username: None,
            env: None,
            group: None,
            schema: None,
            tls: None,
            ssh: None,
    };
    // Creates the file (mode=rwc) and verifies it opens.
    crate::drivers::sqlite::SqliteDriver::test(&cfg).await?;
    state.store.upsert_connection(&cfg).await?;
    Ok(cfg)
}

async fn port_open(host: &str, port: u16) -> bool {
    matches!(
        tokio::time::timeout(
            std::time::Duration::from_millis(450),
            tokio::net::TcpStream::connect((host, port)),
        )
        .await,
        Ok(Ok(_))
    )
}

/// Auto-discovery: probe well-known local database ports and return
/// ready-to-add connection configs for whatever is listening.
#[tauri::command]
pub async fn scan_local_databases() -> AppResult<Vec<ConnectionConfig>> {
    let candidates: [(Engine, u16, &str, &str); 4] = [
        (Engine::Postgres, 5432, "postgres", "postgres"),
        (Engine::MySql, 3306, "mysql", "root"),
        (Engine::Postgres, 5433, "postgres", "postgres"),
        (Engine::MySql, 3307, "mysql", "root"),
    ];
    let mut found = Vec::new();
    for (engine, port, db, user) in candidates {
        if port_open("127.0.0.1", port).await {
            let label = match engine {
                Engine::Postgres => "Postgres",
                Engine::MySql => "MySQL/MariaDB",
                Engine::Sqlite => "SQLite",
            };
            found.push(ConnectionConfig {
                id: format!("detected-{port}"),
                name: format!("{label} on localhost:{port}"),
                engine,
                host: Some("localhost".into()),
                port: Some(port),
                database: db.into(),
                username: Some(user.into()),
                env: None,
                group: None,
                schema: None,
                tls: None,
                ssh: None,
            });
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_rows_evenly_with_remainder() {
        let rows: Vec<Vec<serde_json::Value>> =
            (0..5).map(|i| vec![serde_json::json!(i)]).collect();
        let chunks = chunk_rows(&rows, 2);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].len(), 2);
        assert_eq!(chunks[2].len(), 1);
    }

    #[test]
    fn chunk_size_zero_yields_single_chunk() {
        let rows: Vec<Vec<serde_json::Value>> = vec![vec![serde_json::json!(1)]];
        assert_eq!(chunk_rows(&rows, 0).len(), 1);
    }
}
