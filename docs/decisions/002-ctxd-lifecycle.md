# ADR-002: ctxd daemon lifecycle inside Keepr

**Status:** accepted (2026-04-28)
**Decides:** how `ctxd` is bundled, started, stopped, upgraded, and recovered inside the Keepr desktop app.
**Supersedes:** none.
**Related:** `tasks/ctxd-integration.md`, ADR-001 (subject schema, pending).

---

## Context

v0.2.6 introduces ctxd (`keeprlabs/ctxd`, Apache-2.0, Rust) as Keepr's memory substrate. ctxd is a single-binary daemon that exposes hybrid search, an event log, and an MCP server. Keepr's Rust backend will broker every ctxd call from the React frontend.

We need to decide:
1. How ctxd is packaged (linked crate vs. sidecar binary).
2. How the daemon's lifecycle is managed inside Tauri's lifecycle.
3. How ports, credentials, and crash recovery are handled.
4. How ctxd is upgraded across Keepr releases.
5. How macOS code signing and notarization apply.

## Decision

### 1. Package ctxd as a Tauri sidecar binary, not a linked crate

We ship the prebuilt `ctxd` binary inside `Keepr.app` via Tauri's `bundle.externalBin` and spawn it at runtime via `tauri-plugin-shell`.

**Why sidecar over linked crate:**
- Crash isolation. ctxd panicking does not take Keepr's UI down.
- Update story. ctxd ships its own tagged releases; bumping is a one-line change to `scripts/fetch-ctxd.ts`. Linking would couple every ctxd release to a Keepr code change.
- Transports work without rewiring. ctxd already speaks stdio/SSE/HTTP. As a sidecar bound to loopback, it is exactly what external agents (Claude Code, Cursor) connect to in v0.3.0.
- Bundle delta is smaller. A stripped release-mode `ctxd` binary is ~15-25 MB per arch. Linking would pull in three crate trees plus their deps.

### 2. Ports are random per-user, persisted in `app_config`

On first launch, generate two random TCP ports in the ephemeral range (49152-65535), bind both to `127.0.0.1` only:
- HTTP API port → `app_config.memory.http_port`
- Wire-protocol port → `app_config.memory.wire_port`

Subsequent launches reuse persisted ports. If a port is busy at boot, regenerate and persist the new value.

**Why not a fixed port (e.g. 7777):** two Keepr windows on the same user's machine would collide. A fixed port also leaks the daemon's existence to anyone scanning localhost. Random ports are private to the user and prevent accidental cross-process coupling.

### 3. Lifecycle inside Tauri's setup hook

```
App start
  → setup hook (src-tauri/src/lib.rs)
    → memory::daemon::spawn()
        → ensure binary exists at expected externalBin path
        → read or generate ports from app_config
        → spawn `ctxd serve` with --bind, --wire-bind, --storage,
          --storage-uri, --embedder, --require-auth flags
        → poll GET /health every 100ms up to 5s
        → if healthy: store DaemonHandle in Tauri State
        → if unhealthy: set DaemonHandle::Offline, surface banner
  → window shown

Window close
  → on_window_event(CloseRequested)
    → memory::daemon::shutdown()
        → SIGTERM the child process
        → wait up to 3s for clean exit
        → if still alive: SIGKILL
```

The frontend can call `memory_status` at any time to read daemon state. When state is `Offline`, all `memory_*` commands return a typed error and the frontend renders fallback UI (today: pre-ctxd path; future: read-only mode for some surfaces).

### 4. Crash recovery: restart once, then degrade

If the daemon crashes mid-session (detected via failed health probe or broken pipe on a command), the manager restarts it once with 1s backoff. A second consecutive failure flips state to `Offline` and surfaces a non-blocking banner: *"Memory layer offline — using last-known context. Click to retry."*

The pre-ctxd markdown-tail path in `pipeline.ts` remains the fallback for v0.2.6, so the app is never fully broken.

### 5. Upgrade story: `ctxd migrate` before `serve`

On the first Keepr launch following an upgrade, `memory::daemon::spawn()` runs `ctxd migrate --db <path>` synchronously before `serve`. ctxd guarantees forward-compatible migrations within minor versions. We track the last-known ctxd version in `app_config.memory.ctxd_version` to detect upgrades.

If `ctxd migrate` fails, we surface a blocking error: *"Memory layer needs manual repair. See keepr.app/recovery."* and abort startup.

### 6. macOS code signing and notarization

The bundled `ctxd` binary is signed in the same notarization pass as the main `Keepr` binary. `release.yml` already configures Apple signing secrets; Tauri's `tauri-action` signs everything in `bundle.externalBin` automatically.

For unsigned dev builds, `ctxd` runs identically — there is no Gatekeeper layer for sidecar processes spawned by an already-running app.

### 7. Universal binary via `lipo`

Keepr's `release.yml` builds with `--target universal-apple-darwin`. ctxd v0.3.0 ships separate `aarch64-apple-darwin` and `x86_64-apple-darwin` tarballs. The `scripts/fetch-ctxd.ts` script downloads both and runs `lipo -create` to produce a single `ctxd-universal-apple-darwin` binary. Tauri's externalBin picks this up automatically.

For Linux builds (future), no `lipo` equivalent is needed; we ship per-arch binaries.

## Consequences

**Good:**
- Clean update path for ctxd (one version bump in `scripts/fetch-ctxd.ts`).
- Crash isolation between memory layer and UI.
- MCP transports work for external agents in v0.3.0 with no extra wiring.
- Random ports prevent cross-process coupling and reduce attack surface.

**Bad:**
- Sidecar lifecycle is one of the places Tauri apps die in production (zombie processes after force-quit, signing drift). Mitigated by PID file at `<appdata>/keepr/ctxd.pid` and kill-stale-on-startup.
- Two binaries to sign. If signing breaks for ctxd but works for Keepr (or vice versa), users see Gatekeeper failures. Mitigated by including ctxd in the same signing pass.
- Binary size grows ~25 MB per arch. Acceptable; alerted in CI if total DMG grows past 80 MB net.

**Neutral:**
- Random ports mean we cannot document a stable "ctxd is at localhost:X" interface for external tools. v0.3.0's external-MCP toggle will copy port + token to clipboard for the user.

## Alternatives considered

### A. Link `ctxd-cli` as a Rust crate and run in-process

Rejected. Crash isolation lost, update story coupled to Keepr releases, MCP transports would need re-implementation in Keepr's Rust crate.

### B. Run ctxd as a system service via `launchd`

Rejected. Requires elevated permissions for installation, breaks the "drag to Applications" install flow, exposes the daemon to other apps on the system, makes uninstall messy.

### C. Bundle ctxd source and build at install time

Rejected. Adds Rust toolchain as a runtime dependency for users, ~5 minute install time, fragile across macOS versions.

### D. Vendor binaries committed to the repo

Rejected for v0.2.6. Adds ~80 MB of binary commits per ctxd release. Fetch-on-build keeps the repo clean and works deterministically. Revisit if CI build times become a problem.

## Validation

PR 1 (`feat/ctxd-bundle`) ships this lifecycle behind a `memory_status` Tauri command. Manual smoke test: `npx tauri dev` → Settings shows "Memory layer: ✓ ready" with the random port. Automated test in `src-tauri/src/memory/daemon.rs` exercises spawn → health-probe → shutdown with a mocked binary.
