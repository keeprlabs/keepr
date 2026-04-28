//! Memory subsystem — ctxd sidecar lifecycle and Tauri commands.
//!
//! See `tasks/ctxd-integration.md` (overall plan) and
//! `docs/decisions/002-ctxd-lifecycle.md` (lifecycle ADR).
//!
//! v0.2.6 PR 1 ships only the daemon lifecycle and a `memory_status` command.
//! Subsequent PRs add `memory_query`, `memory_read`, `memory_write`, etc.

pub mod daemon;
pub mod ports;

use tauri::State;

pub use daemon::{spawn, shutdown, DaemonHandle, DaemonState};

/// Returns the current daemon state. Frontend renders this as the
/// "Memory layer" indicator on Settings.
#[tauri::command]
pub async fn memory_status(handle: State<'_, DaemonHandle>) -> Result<DaemonState, String> {
    Ok(handle.snapshot().await)
}
