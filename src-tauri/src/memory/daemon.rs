//! ctxd sidecar lifecycle: spawn, health-probe, shutdown, restart-once.
//!
//! See `docs/decisions/002-ctxd-lifecycle.md`. The daemon manager owns:
//!   - the child process handle (when running)
//!   - the bound HTTP/wire ports
//!   - the current `DaemonState` for status reporting and crash recovery.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use super::ports::DaemonPorts;

const SIDECAR_NAME: &str = "ctxd";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Current status of the ctxd sidecar. Surfaced via `memory_status` Tauri command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum DaemonState {
    /// Spawn invoked but health probe hasn't completed yet.
    Starting,
    /// Healthy and accepting requests on these ports.
    Ready { http_port: u16, wire_port: u16 },
    /// Spawn failed or daemon crashed past the restart limit. `reason` is for the UI.
    Offline { reason: String },
}

impl Default for DaemonState {
    fn default() -> Self {
        Self::Starting
    }
}

/// Tauri-managed handle for the ctxd daemon. Stored as managed state.
pub struct DaemonHandle {
    state: Arc<Mutex<DaemonState>>,
    child: Arc<Mutex<Option<CommandChild>>>,
}

impl DaemonHandle {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(DaemonState::default())),
            child: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn snapshot(&self) -> DaemonState {
        self.state.lock().await.clone()
    }

    async fn set_state(&self, next: DaemonState) {
        *self.state.lock().await = next;
    }
}

/// Spawn the sidecar and run a health probe. On success, transitions state to
/// `Ready`. On failure, sets `Offline` and returns the error — the caller
/// (Tauri setup hook) decides whether to surface it.
pub async fn spawn(app: &AppHandle, handle: &DaemonHandle) -> Result<()> {
    handle.set_state(DaemonState::Starting).await;

    let ports = DaemonPorts::allocate_fresh().context("allocating ctxd ports")?;
    let db_path = ctxd_db_path(app).context("resolving ctxd.db path")?;

    // Make sure the parent directory exists.
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).context("creating ctxd data dir")?;
    }

    let bind = format!("127.0.0.1:{}", ports.http);
    let wire_bind = format!("127.0.0.1:{}", ports.wire);
    let db_arg = db_path
        .to_str()
        .ok_or_else(|| anyhow!("ctxd.db path is not valid utf-8: {db_path:?}"))?
        .to_string();

    log::info!(
        target: "memory::daemon",
        "starting ctxd sidecar (http={}, wire={}, db={})",
        bind, wire_bind, db_arg
    );

    let sidecar = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .context("resolving ctxd sidecar binary")?
        .args([
            "serve",
            "--bind",
            &bind,
            "--wire-bind",
            &wire_bind,
            "--db",
            &db_arg,
            "--embedder",
            "null",
        ]);

    let (mut rx, child) = sidecar.spawn().context("spawning ctxd sidecar")?;
    *handle.child.lock().await = Some(child);

    // Drain stdout/stderr to logs so failures surface in the user's log file.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!(target: "ctxd", "{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Stderr(line) => {
                    // ctxd uses tracing-subscriber to stderr; surface as info.
                    log::info!(target: "ctxd", "{}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Error(err) => {
                    log::error!(target: "ctxd", "sidecar error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!(
                        target: "ctxd",
                        "sidecar terminated (code={:?}, signal={:?})",
                        payload.code, payload.signal
                    );
                }
                _ => {}
            }
        }
    });

    match poll_health(ports.http, HEALTH_TIMEOUT).await {
        Ok(()) => {
            handle
                .set_state(DaemonState::Ready {
                    http_port: ports.http,
                    wire_port: ports.wire,
                })
                .await;
            log::info!(target: "memory::daemon", "ctxd ready on {bind}");
            Ok(())
        }
        Err(err) => {
            // Kill the child — it may be stuck.
            shutdown(handle).await;
            let reason = format!("ctxd did not become healthy: {err}");
            handle
                .set_state(DaemonState::Offline {
                    reason: reason.clone(),
                })
                .await;
            log::error!(target: "memory::daemon", "{reason}");
            Err(anyhow!(reason))
        }
    }
}

/// Send SIGTERM (or platform equivalent) and forget the child. Caller should
/// `await` this; it is best-effort and will not return errors.
pub async fn shutdown(handle: &DaemonHandle) {
    let mut guard = handle.child.lock().await;
    if let Some(child) = guard.take() {
        if let Err(err) = child.kill() {
            log::warn!(target: "memory::daemon", "kill ctxd: {err}");
        } else {
            log::info!(target: "memory::daemon", "ctxd shutdown sent");
        }
    }
    handle
        .set_state(DaemonState::Offline {
            reason: "shutdown".to_string(),
        })
        .await;
}

fn ctxd_db_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .context("resolving app data dir")?;
    Ok(dir.join("ctxd.db"))
}

/// Poll `GET http://127.0.0.1:<port>/health` until 200 OK or timeout.
/// Hand-rolled minimal HTTP/1.1 client over std TCP — avoids pulling
/// reqwest/hyper into the dep tree just for one liveness probe.
async fn poll_health(port: u16, timeout: Duration) -> Result<()> {
    let deadline = Instant::now() + timeout;
    let mut last_err: Option<anyhow::Error> = None;

    while Instant::now() < deadline {
        match probe_once(port).await {
            Ok(()) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
        tokio::time::sleep(HEALTH_POLL_INTERVAL).await;
    }

    Err(last_err.unwrap_or_else(|| anyhow!("health probe timed out")))
}

async fn probe_once(port: u16) -> Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .context("tcp connect")?;
    let req = b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    stream.write_all(req).await.context("write req")?;
    let mut buf = Vec::with_capacity(256);
    // Read just enough to see the status line and a bit of body.
    let mut tmp = [0u8; 256];
    let mut total = 0;
    while total < 256 {
        let n = stream.read(&mut tmp).await.context("read resp")?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        total += n;
    }
    let head = String::from_utf8_lossy(&buf);
    if head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200") {
        Ok(())
    } else {
        Err(anyhow!("unexpected response: {}", head.lines().next().unwrap_or("")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    async fn fake_health_server(response: &'static [u8]) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                if let Ok((mut sock, _)) = listener.accept().await {
                    let _ = sock.write_all(response).await;
                    let _ = sock.shutdown().await;
                }
            }
        });
        port
    }

    #[tokio::test]
    async fn probe_once_succeeds_on_200() {
        let port =
            fake_health_server(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok").await;
        probe_once(port).await.expect("expected ok");
    }

    #[tokio::test]
    async fn probe_once_fails_on_500() {
        let port = fake_health_server(
            b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n",
        )
        .await;
        assert!(probe_once(port).await.is_err());
    }

    #[tokio::test]
    async fn poll_health_returns_ok_within_timeout() {
        let port =
            fake_health_server(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok").await;
        poll_health(port, Duration::from_secs(2))
            .await
            .expect("should succeed");
    }

    #[tokio::test]
    async fn poll_health_times_out_when_unreachable() {
        // Bind a port, then drop it — connect attempts will fail until timeout.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let res = poll_health(port, Duration::from_millis(300)).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn daemon_state_starts_as_starting() {
        let handle = DaemonHandle::new();
        match handle.snapshot().await {
            DaemonState::Starting => {}
            other => panic!("expected Starting, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn daemon_state_transitions_on_set_state() {
        let handle = DaemonHandle::new();
        handle
            .set_state(DaemonState::Ready {
                http_port: 1234,
                wire_port: 5678,
            })
            .await;
        match handle.snapshot().await {
            DaemonState::Ready { http_port, wire_port } => {
                assert_eq!(http_port, 1234);
                assert_eq!(wire_port, 5678);
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }
}
