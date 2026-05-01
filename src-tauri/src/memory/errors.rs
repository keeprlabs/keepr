//! Errors surfaced from the memory subsystem to Tauri commands.
//!
//! The frontend gets a tagged-enum JSON. UI code should match on `kind`
//! and render the right empty/error state. We map every internal error
//! to one of these variants — never expose `anyhow::Error` strings raw,
//! since the frontend can't react meaningfully to them.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(rename_all = "snake_case", tag = "kind", content = "message")]
pub enum MemoryError {
    /// Daemon is not yet `Ready` (still starting, or crashed).
    /// UI should render the offline empty-state and offer Refresh.
    #[error("memory layer offline: {0}")]
    Offline(String),

    /// Operation timed out talking to the daemon. Usually transient.
    #[error("memory operation timed out: {0}")]
    Timeout(String),

    /// Subject or resource doesn't exist. UI should render an empty
    /// result, NOT an error toast — most "not found" outcomes are
    /// expected (e.g. `memory_related` on an isolated subject).
    #[error("not found: {0}")]
    NotFound(String),

    /// Caller passed an invalid argument (empty subject, malformed
    /// filter, unsupported view, …). Indicates a frontend bug.
    #[error("bad request: {0}")]
    BadRequest(String),

    /// Anything else. Frontend shows a generic toast and logs.
    #[error("internal error: {0}")]
    Internal(String),

    /// SDK doesn't yet expose this primitive in v0.3.0. v0.4 will land
    /// `subjects`, `related`, `entities`, `timeline`. Treat as empty
    /// result in the UI for now.
    #[error("not yet supported in this ctxd SDK version: {0}")]
    NotYetSupported(String),
}

impl MemoryError {
    pub fn offline(reason: impl Into<String>) -> Self {
        Self::Offline(reason.into())
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }
    pub fn not_yet_supported(what: impl Into<String>) -> Self {
        Self::NotYetSupported(what.into())
    }
}

/// Convert an `anyhow::Error` into a `MemoryError::Internal`. Use when
/// you have no better classification.
impl From<anyhow::Error> for MemoryError {
    fn from(e: anyhow::Error) -> Self {
        Self::Internal(e.to_string())
    }
}

impl From<ctxd_client::CtxdError> for MemoryError {
    fn from(e: ctxd_client::CtxdError) -> Self {
        // ctxd_client doesn't (yet) expose typed variants we can match
        // on cleanly across versions. Stringify and classify by
        // substring — small surface, easy to update if the SDK changes.
        let s = e.to_string();
        let lower = s.to_lowercase();
        if lower.contains("not found") || lower.contains("404") {
            Self::NotFound(s)
        } else if lower.contains("timeout") || lower.contains("timed out") {
            Self::Timeout(s)
        } else if lower.contains("connection refused")
            || lower.contains("connection reset")
            || lower.contains("broken pipe")
        {
            Self::Offline(s)
        } else if lower.contains("unauthorized") || lower.contains("forbidden") {
            Self::BadRequest(s)
        } else {
            Self::Internal(s)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_serializes_with_kind_and_message() {
        let err = MemoryError::offline("daemon not ready");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains(r#""kind":"offline""#));
        assert!(json.contains(r#""message":"daemon not ready""#));
    }

    #[test]
    fn not_found_uses_snake_case_tag() {
        let err = MemoryError::NotFound("/keepr/people/missing".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains(r#""kind":"not_found""#));
    }

    #[test]
    fn anyhow_converts_to_internal() {
        let any: anyhow::Error = anyhow::anyhow!("boom");
        let mem: MemoryError = any.into();
        assert!(matches!(mem, MemoryError::Internal(_)));
    }
}
