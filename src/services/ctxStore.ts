// Frontend wrapper for the ctxd memory subsystem. The Rust backend brokers
// every ctxd call (see src-tauri/src/memory/) so this file only knows about
// Tauri commands — never about ctxd's own HTTP/wire protocols. See
// `tasks/ctxd-integration.md` for the full plan and `docs/decisions/`.
//
// v0.2.6 PR 1: only `memory_status` exists. Subsequent PRs add query/read/
// write/subjects/related/subscribe.

import { invoke } from "@tauri-apps/api/core";

/**
 * Daemon lifecycle states. Discriminated union — match on `status`.
 *
 * Mirrors Rust's `memory::DaemonState` (snake_case via serde tagged enum).
 */
export type DaemonState =
  | { status: "starting" }
  | { status: "ready"; http_port: number; wire_port: number }
  | { status: "offline"; reason: string };

/** Read the current daemon state. Cheap — pure memory lookup in Rust. */
export async function memoryStatus(): Promise<DaemonState> {
  return invoke<DaemonState>("memory_status");
}

/** Convenience: true if the daemon is up and accepting requests. */
export function isReady(state: DaemonState): state is Extract<DaemonState, { status: "ready" }> {
  return state.status === "ready";
}
