//! Random per-user TCP ports for the ctxd sidecar.
//!
//! See `docs/decisions/002-ctxd-lifecycle.md` for why.

use std::net::TcpListener;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Two ports the daemon listens on: HTTP admin API + wire protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaemonPorts {
    pub http: u16,
    pub wire: u16,
}

impl DaemonPorts {
    /// Allocate two distinct, currently-free ephemeral ports by binding and
    /// dropping a `TcpListener`. This is racy — another process can grab the
    /// port between drop and ctxd's bind — but acceptable on a per-user
    /// workstation where contention is essentially zero.
    pub fn allocate_fresh() -> Result<Self> {
        let http = pick_ephemeral_port().context("allocating http port")?;
        // Re-pick if collision (rare).
        let mut wire = pick_ephemeral_port().context("allocating wire port")?;
        while wire == http {
            wire = pick_ephemeral_port()?;
        }
        Ok(Self { http, wire })
    }
}

fn pick_ephemeral_port() -> Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").context("binding ephemeral port")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocate_fresh_returns_distinct_loopback_ports() {
        let ports = DaemonPorts::allocate_fresh().unwrap();
        assert_ne!(ports.http, ports.wire);
        // Ephemeral range on macOS/Linux defaults are 49152+ and 32768+
        // respectively, but the kernel may pick anything > 1023. Just
        // require non-zero and non-privileged.
        assert!(ports.http > 1023);
        assert!(ports.wire > 1023);
    }

    #[test]
    fn pick_ephemeral_port_returns_usable_port() {
        let port = pick_ephemeral_port().unwrap();
        // Should be re-bindable immediately after drop.
        let _ = TcpListener::bind(format!("127.0.0.1:{port}")).unwrap();
    }
}
