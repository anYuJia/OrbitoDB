use std::collections::HashMap;
use std::net::TcpListener as StdTcpListener;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::process::{Child, Command};
use tokio::sync::{Mutex, RwLock};
use tokio::time::sleep;

use crate::drivers::{sqlite::SqliteDriver, Driver};
use crate::error::{AppError, AppResult};
use crate::types::{ConnectionConfig, Engine, SshAuth};

/// A database connection can optionally be reached through the user's system
/// OpenSSH client. We intentionally use non-interactive auth only: ssh-agent or
/// an unencrypted/private key already usable by OpenSSH.
pub async fn prepare_connection(
    cfg: &ConnectionConfig,
) -> AppResult<(ConnectionConfig, Option<Child>)> {
    let Some(ssh) = cfg.ssh.as_ref().filter(|ssh| ssh.enabled) else {
        return Ok((cfg.clone(), None));
    };

    if cfg.engine == Engine::Sqlite {
        return Err(AppError::ConnectionFailed(
            "SSH tunneling is only available for PostgreSQL and MySQL/MariaDB".into(),
        ));
    }
    if ssh.host.trim().is_empty() || ssh.username.trim().is_empty() {
        return Err(AppError::ConnectionFailed(
            "SSH host and username are required".into(),
        ));
    }

    let database_host = cfg.host.as_deref().unwrap_or("localhost");
    let database_port = cfg.port.unwrap_or(match cfg.engine {
        Engine::Postgres => 5432,
        Engine::MySql => 3306,
        Engine::Sqlite => unreachable!(),
    });
    let local_port = reserve_local_port()?;

    let mut args = vec![
        "-N".to_string(),
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-o".to_string(),
        "ConnectTimeout=8".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=30".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
        "-L".to_string(),
        format!("127.0.0.1:{local_port}:{database_host}:{database_port}"),
        "-p".to_string(),
        ssh.port.to_string(),
    ];

    match ssh.auth {
        SshAuth::Agent => {}
        SshAuth::Key => {
            let key = ssh
                .private_key_path
                .as_deref()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .ok_or_else(|| {
                    AppError::ConnectionFailed(
                        "SSH private-key authentication requires a key file path".into(),
                    )
                })?;
            args.push("-i".to_string());
            args.push(expand_home(key));
        }
    }

    args.push(format!("{}@{}", ssh.username.trim(), ssh.host.trim()));

    let mut command = Command::new("ssh");
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = command.spawn().map_err(|error| {
        AppError::ConnectionFailed(format!(
            "could not start the system OpenSSH client: {error}. Install or enable the 'ssh' command first"
        ))
    })?;

    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            AppError::ConnectionFailed(format!("failed to inspect SSH tunnel process: {error}"))
        })? {
            return Err(AppError::ConnectionFailed(format!(
                "SSH tunnel exited before it became ready ({status}). Check the SSH host, user, key/agent and known-host settings"
            )));
        }

        if tokio::net::TcpStream::connect(("127.0.0.1", local_port))
            .await
            .is_ok()
        {
            break;
        }

        if Instant::now() >= deadline {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(AppError::ConnectionFailed(
                "SSH tunnel did not become ready within 8 seconds".into(),
            ));
        }
        sleep(Duration::from_millis(100)).await;
    }

    let mut effective = cfg.clone();
    effective.host = Some("127.0.0.1".into());
    effective.port = Some(local_port);
    effective.ssh = None;
    Ok((effective, Some(child)))
}

pub async fn stop_tunnel(mut tunnel: Option<Child>) {
    if let Some(mut child) = tunnel.take() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

fn expand_home(path: &str) -> String {
    if path == "~" || path.starts_with("~/") || path.starts_with("~\\") {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            let suffix = path.trim_start_matches('~').trim_start_matches(['/', '\\']);
            return std::path::PathBuf::from(home)
                .join(suffix)
                .to_string_lossy()
                .into_owned();
        }
    }
    path.to_string()
}

fn reserve_local_port() -> AppResult<u16> {
    let listener = StdTcpListener::bind(("127.0.0.1", 0)).map_err(|error| {
        AppError::ConnectionFailed(format!("could not reserve a local SSH tunnel port: {error}"))
    })?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|error| {
            AppError::ConnectionFailed(format!(
                "could not read the reserved SSH tunnel port: {error}"
            ))
        })
}

/// Holds live database drivers and any OpenSSH child process associated with
/// each saved connection id.
pub struct ConnectionRegistry {
    live: RwLock<HashMap<String, Arc<dyn Driver>>>,
    tunnels: Mutex<HashMap<String, Child>>,
}

impl ConnectionRegistry {
    pub fn new() -> Self {
        Self {
            live: RwLock::new(HashMap::new()),
            tunnels: Mutex::new(HashMap::new()),
        }
    }

    pub async fn open(&self, cfg: &ConnectionConfig, password: Option<&str>) -> AppResult<()> {
        self.close(&cfg.id).await;
        let (effective, tunnel) = prepare_connection(cfg).await?;

        let driver: AppResult<Arc<dyn Driver>> = match effective.engine {
            Engine::Sqlite => SqliteDriver::connect(&effective)
                .await
                .map(|driver| Arc::new(driver) as Arc<dyn Driver>),
            Engine::Postgres => crate::drivers::postgres::PgDriver::connect(&effective, password)
                .await
                .map(|driver| Arc::new(driver) as Arc<dyn Driver>),
            Engine::MySql => crate::drivers::mysql::MySqlDriver::connect(&effective, password)
                .await
                .map(|driver| Arc::new(driver) as Arc<dyn Driver>),
        };

        match driver {
            Ok(driver) => {
                self.live.write().await.insert(cfg.id.clone(), driver);
                if let Some(child) = tunnel {
                    self.tunnels.lock().await.insert(cfg.id.clone(), child);
                }
                Ok(())
            }
            Err(error) => {
                stop_tunnel(tunnel).await;
                Err(error)
            }
        }
    }

    pub async fn get(&self, id: &str) -> AppResult<Arc<dyn Driver>> {
        self.live
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("connection not open: {id}")))
    }

    pub async fn close(&self, id: &str) {
        self.live.write().await.remove(id);
        let tunnel = self.tunnels.lock().await.remove(id);
        stop_tunnel(tunnel).await;
    }
}

impl Default for ConnectionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> ConnectionConfig {
        ConnectionConfig {
            id: "c1".into(),
            name: "m".into(),
            engine: Engine::Sqlite,
            host: None,
            port: None,
            database: ":memory:".into(),
            username: None,
            env: None,
            group: None,
            schema: None,
            ssh: None,
        }
    }

    #[tokio::test]
    async fn opens_gets_and_closes() {
        let reg = ConnectionRegistry::new();
        reg.open(&cfg(), None).await.unwrap();
        let d = reg.get("c1").await.unwrap();
        d.execute("SELECT 1").await.unwrap();
        reg.close("c1").await;
        assert!(reg.get("c1").await.is_err());
    }

    #[test]
    fn reserves_ephemeral_local_port() {
        assert!(reserve_local_port().unwrap() > 0);
    }
}
