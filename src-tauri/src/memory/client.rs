//! Thin wrapper around `ctxd_client::CtxdClient` owned by the daemon
//! handle. The Tauri command surface (in `mod.rs`) calls into this —
//! frontend code never sees an SDK type directly.
//!
//! Built once when the daemon transitions to `Ready`. If the daemon
//! crashes and restarts, the client is rebuilt with the new ports.
//!
//! Concurrency: the SDK's `CtxdClient` is not `Clone`, so we hold it
//! behind `Arc` and hand out cheap reference-counted copies. The outer
//! mutex is only held during install/clear; commands borrow the client
//! without serializing.

use std::sync::Arc;

use ctxd_client::{CtxdClient, QueryView};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::async_runtime::Mutex;

use super::errors::MemoryError;

/// Lazily-built ctxd SDK client. Stored on `DaemonHandle::client` and
/// (re)initialized each time the daemon hits `Ready`.
pub struct ClientCell {
    inner: Arc<Mutex<Option<Arc<CtxdClient>>>>,
}

impl Default for ClientCell {
    fn default() -> Self {
        Self::empty()
    }
}

impl ClientCell {
    pub fn empty() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
        }
    }

    /// Replace the cached client. Called by `daemon::spawn` after a
    /// successful health probe.
    pub async fn install(&self, http_addr: &str, wire_addr: &str) -> Result<(), MemoryError> {
        let client = CtxdClient::connect(http_addr)
            .await
            .map_err(MemoryError::from)?
            .with_wire(wire_addr)
            .await
            .map_err(MemoryError::from)?;
        *self.inner.lock().await = Some(Arc::new(client));
        Ok(())
    }

    /// Drop the cached client. Called on shutdown / crash.
    pub async fn clear(&self) {
        *self.inner.lock().await = None;
    }

    /// Acquire a reference-counted handle to the current client, or
    /// return `Offline` if no client is installed.
    async fn client(&self) -> Result<Arc<CtxdClient>, MemoryError> {
        self.inner
            .lock()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| MemoryError::offline("ctxd client not initialized"))
    }

    // ---------- High-level operations ----------

    pub async fn write(
        &self,
        subject: &str,
        event_type: &str,
        data: Value,
    ) -> Result<String, MemoryError> {
        validate_subject(subject)?;
        if event_type.is_empty() {
            return Err(MemoryError::bad_request("event_type must not be empty"));
        }
        let client = self.client().await?;
        let id = client
            .write(subject, event_type, data)
            .await
            .map_err(MemoryError::from)?;
        Ok(id.to_string())
    }

    pub async fn read(&self, subject: &str) -> Result<Vec<EventRow>, MemoryError> {
        validate_subject(subject)?;
        let client = self.client().await?;
        let events = client
            .query(subject, QueryView::Log)
            .await
            .map_err(MemoryError::from)?;
        Ok(events.into_iter().map(EventRow::from_event).collect())
    }

    pub async fn query(
        &self,
        subject: &str,
        _filters: QueryFilters,
        _top_k: u32,
    ) -> Result<Vec<EventRow>, MemoryError> {
        validate_subject(subject)?;
        // v0.3.0 SDK exposes `QueryView::Fts` (FTS5) and `QueryView::Log`
        // (chronological). Hybrid (vector + RRF) requires the daemon to
        // be configured with an embedder; v0.2.7 ships embedder=null.
        // FTS is what we actually get even when the user asked for
        // semantic. v0.3.0's `feat/memory-embedder-opt-in` widens this.
        let client = self.client().await?;
        let events = client
            .query(subject, QueryView::Fts)
            .await
            .map_err(MemoryError::from)?;
        Ok(events.into_iter().map(EventRow::from_event).collect())
    }

    /// `subjects`, `related`, `entities`, `timeline` are not exposed by
    /// the v0.3.0 Rust SDK (only by the daemon's MCP server). Until
    /// the SDK lands these, surface `NotYetSupported` so the UI can
    /// render an empty state without faking the result.
    pub async fn subjects(&self, _prefix: &str) -> Result<Vec<String>, MemoryError> {
        Err(MemoryError::not_yet_supported(
            "memory_subjects: ctxd-client v0.3.0 does not expose subject listing; lands in v0.4",
        ))
    }

    pub async fn related(&self, _subject: &str) -> Result<Vec<EventRow>, MemoryError> {
        Err(MemoryError::not_yet_supported(
            "memory_related: ctxd-client v0.3.0 does not expose ctx_related; lands in v0.4",
        ))
    }

    /// Subscribe stub. v0.2.7 PR 9 (activity sidebar) will wire the
    /// real `EventStream` → Tauri event-emit bridge. For now, return
    /// an opaque channel id and signal that the channel is closed.
    pub async fn subscribe_stub(&self, _pattern: &str) -> Result<SubscribeStub, MemoryError> {
        // Don't claim a stub channel when daemon is down.
        let _ = self.client().await?;
        Ok(SubscribeStub {
            channel_id: "stub".to_string(),
            note: "subscribe is stubbed in v0.2.7 PR 2; live feed lands in PR 9".to_string(),
        })
    }
}

fn validate_subject(subject: &str) -> Result<(), MemoryError> {
    if subject.is_empty() {
        return Err(MemoryError::bad_request("subject must not be empty"));
    }
    if !subject.starts_with('/') {
        return Err(MemoryError::bad_request(format!(
            "subject must start with '/': got {subject:?}"
        )));
    }
    Ok(())
}

// ---------- Wire types exposed to the frontend ----------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueryFilters {
    /// Future: source filter ("github", "keepr", ...). Ignored by
    /// v0.3.0 SDK; reserved so the frontend contract is stable.
    pub source: Option<String>,
    /// Future: actor filter (member uuid). Same.
    pub actor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EventRow {
    pub id: String,
    pub subject: String,
    pub event_type: String,
    pub data: Value,
    pub timestamp: String,
}

impl EventRow {
    fn from_event(e: ctxd_client::Event) -> Self {
        Self {
            id: e.id.to_string(),
            subject: e.subject.to_string(),
            event_type: e.event_type,
            data: e.data,
            timestamp: e.time.to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SubscribeStub {
    pub channel_id: String,
    pub note: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn write_validates_empty_subject() {
        let cell = ClientCell::empty();
        let err = cell
            .write("", "ctx.note", serde_json::json!({}))
            .await
            .expect_err("expected bad_request");
        assert!(matches!(err, MemoryError::BadRequest(_)));
    }

    #[tokio::test]
    async fn write_validates_subject_prefix() {
        let cell = ClientCell::empty();
        let err = cell
            .write("not-a-path", "ctx.note", serde_json::json!({}))
            .await
            .expect_err("expected bad_request");
        assert!(matches!(err, MemoryError::BadRequest(_)));
    }

    #[tokio::test]
    async fn write_returns_offline_when_no_client() {
        let cell = ClientCell::empty();
        let err = cell
            .write("/keepr/test", "ctx.note", serde_json::json!({}))
            .await
            .expect_err("expected offline");
        assert!(matches!(err, MemoryError::Offline(_)));
    }

    #[tokio::test]
    async fn read_returns_offline_when_no_client() {
        let cell = ClientCell::empty();
        let err = cell.read("/keepr/test").await.expect_err("expected offline");
        assert!(matches!(err, MemoryError::Offline(_)));
    }

    #[tokio::test]
    async fn query_returns_offline_when_no_client() {
        let cell = ClientCell::empty();
        let err = cell
            .query("/keepr/test", QueryFilters::default(), 10)
            .await
            .expect_err("expected offline");
        assert!(matches!(err, MemoryError::Offline(_)));
    }

    #[tokio::test]
    async fn subjects_returns_not_yet_supported() {
        let cell = ClientCell::empty();
        let err = cell.subjects("/keepr").await.expect_err("expected unsupported");
        assert!(matches!(err, MemoryError::NotYetSupported(_)));
    }

    #[tokio::test]
    async fn related_returns_not_yet_supported() {
        let cell = ClientCell::empty();
        let err = cell.related("/keepr/test").await.expect_err("expected unsupported");
        assert!(matches!(err, MemoryError::NotYetSupported(_)));
    }

    #[tokio::test]
    async fn empty_event_type_is_bad_request() {
        let cell = ClientCell::empty();
        let err = cell
            .write("/keepr/test", "", serde_json::json!({}))
            .await
            .expect_err("expected bad_request");
        assert!(matches!(err, MemoryError::BadRequest(_)));
    }

    #[tokio::test]
    async fn subscribe_stub_returns_offline_when_no_client() {
        let cell = ClientCell::empty();
        let err = cell.subscribe_stub("/keepr/**").await.expect_err("expected offline");
        assert!(matches!(err, MemoryError::Offline(_)));
    }
}
