//! Memory subsystem — ctxd sidecar lifecycle and Tauri commands.
//!
//! See `tasks/ctxd-integration.md` (overall plan) and
//! `docs/decisions/002-ctxd-lifecycle.md` (lifecycle ADR).
//!
//! v0.2.7 PR 1 shipped the daemon lifecycle and `memory_status`.
//! v0.2.7 PR 2 (this commit) adds the rest of the command surface:
//! `memory_query`, `memory_read`, `memory_write`, `memory_subjects`,
//! `memory_related`, `memory_subscribe`. Subsequent PRs (3–11) consume
//! these from the frontend and wire dual-writes.

pub mod client;
pub mod daemon;
pub mod errors;
pub mod ports;

use serde_json::Value;
use tauri::State;

pub use client::{ClientCell, EventRow, QueryFilters, SubscribeStub};
pub use daemon::{shutdown, spawn, DaemonHandle, DaemonState};
pub use errors::MemoryError;

/// Returns the current daemon state. Frontend renders this as the
/// "Memory layer" indicator on Settings.
#[tauri::command]
pub async fn memory_status(handle: State<'_, DaemonHandle>) -> Result<DaemonState, String> {
    Ok(handle.snapshot().await)
}

/// Append an event under a subject path. Returns the event UUID as a
/// string. Validates subject is non-empty and starts with `/`.
#[tauri::command]
pub async fn memory_write(
    handle: State<'_, DaemonHandle>,
    subject: String,
    event_type: String,
    data: Value,
) -> Result<String, MemoryError> {
    handle.client().write(&subject, &event_type, data).await
}

/// Read events under a subject in chronological (log) order. Use this
/// for "show me Priya's recent activity"-shaped queries where ordering
/// matters more than relevance.
#[tauri::command]
pub async fn memory_read(
    handle: State<'_, DaemonHandle>,
    subject: String,
) -> Result<Vec<EventRow>, MemoryError> {
    handle.client().read(&subject).await
}

/// Hybrid search over a subject prefix. Returns top-K results ranked
/// by FTS score (v0.2.7) or RRF over FTS+vector (v0.3.0+ when an
/// embedder is configured).
#[tauri::command]
pub async fn memory_query(
    handle: State<'_, DaemonHandle>,
    subject: String,
    filters: Option<QueryFilters>,
    top_k: Option<u32>,
) -> Result<Vec<EventRow>, MemoryError> {
    let filters = filters.unwrap_or_default();
    let top_k = top_k.unwrap_or(20);
    handle.client().query(&subject, filters, top_k).await
}

/// List subjects under a prefix. Stubbed in v0.2.7 PR 2 — the v0.3.0
/// SDK does not expose subject listing. UI should treat
/// `NotYetSupported` as an empty result.
#[tauri::command]
pub async fn memory_subjects(
    handle: State<'_, DaemonHandle>,
    prefix: String,
) -> Result<Vec<String>, MemoryError> {
    handle.client().subjects(&prefix).await
}

/// Entity neighborhood for a subject. Stubbed in v0.2.7 PR 2 — the
/// v0.3.0 SDK does not expose `ctx_related`. UI should treat
/// `NotYetSupported` as an empty result and render the empty state.
#[tauri::command]
pub async fn memory_related(
    handle: State<'_, DaemonHandle>,
    subject: String,
) -> Result<Vec<EventRow>, MemoryError> {
    handle.client().related(&subject).await
}

/// Subscribe stub. Returns an opaque channel id. v0.2.7 PR 9 wires
/// the real EventStream → Tauri event-emit bridge. Until then, the
/// channel never produces events.
#[tauri::command]
pub async fn memory_subscribe(
    handle: State<'_, DaemonHandle>,
    pattern: String,
) -> Result<SubscribeStub, MemoryError> {
    handle.client().subscribe_stub(&pattern).await
}
