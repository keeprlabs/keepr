// Frontend wrapper for the ctxd memory subsystem. The Rust backend brokers
// every ctxd call (see src-tauri/src/memory/) so this file only knows about
// Tauri commands — never about ctxd's own HTTP/wire protocols. See
// `tasks/ctxd-integration.md` for the full plan and `docs/decisions/`.
//
// v0.2.7 PR 2: full command surface. Subscribe is stubbed until PR 9
// (activity sidebar) wires the real EventStream → Tauri event-emit bridge.

import { invoke } from "@tauri-apps/api/core";

// ---------- Types --------------------------------------------------------

/**
 * Daemon lifecycle states. Mirrors Rust's `memory::DaemonState`.
 */
export type DaemonState =
  | { status: "starting" }
  | { status: "ready"; http_port: number; wire_port: number }
  | { status: "offline"; reason: string };

/**
 * Errors surfaced from `memory_*` Tauri commands. Mirrors Rust's
 * `memory::MemoryError`. Callers should match on `kind`:
 *   - `offline`/`timeout`: render fallback UI + Refresh button
 *   - `not_found`/`not_yet_supported`: render empty state, NOT an error
 *   - `bad_request`/`internal`: log + generic error toast
 */
export type MemoryError =
  | { kind: "offline"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "bad_request"; message: string }
  | { kind: "internal"; message: string }
  | { kind: "not_yet_supported"; message: string };

/** A single event row from ctxd. */
export interface EventRow {
  id: string;
  subject: string;
  event_type: string;
  data: unknown;
  timestamp: string;
}

export interface QueryFilters {
  source?: string | null;
  actor?: string | null;
}

export interface SubscribeStub {
  channel_id: string;
  note: string;
}

// ---------- Commands ------------------------------------------------------

export async function memoryStatus(): Promise<DaemonState> {
  return invoke<DaemonState>("memory_status");
}

export async function memoryWrite(
  subject: string,
  eventType: string,
  data: unknown
): Promise<string> {
  return invoke<string>("memory_write", { subject, eventType, data });
}

export async function memoryRead(subject: string): Promise<EventRow[]> {
  return invoke<EventRow[]>("memory_read", { subject });
}

export async function memoryQuery(
  subject: string,
  options: { filters?: QueryFilters; topK?: number } = {}
): Promise<EventRow[]> {
  return invoke<EventRow[]>("memory_query", {
    subject,
    filters: options.filters ?? null,
    topK: options.topK ?? null,
  });
}

export async function memorySubjects(prefix: string): Promise<string[]> {
  return invoke<string[]>("memory_subjects", { prefix });
}

export async function memoryRelated(subject: string): Promise<EventRow[]> {
  return invoke<EventRow[]>("memory_related", { subject });
}

export async function memorySubscribe(pattern: string): Promise<SubscribeStub> {
  return invoke<SubscribeStub>("memory_subscribe", { pattern });
}

// ---------- Helpers -------------------------------------------------------

export function isReady(
  state: DaemonState
): state is Extract<DaemonState, { status: "ready" }> {
  return state.status === "ready";
}

/**
 * `not_found` and `not_yet_supported` represent "no data" outcomes that
 * UIs should render as empty state, not as errors. Use this to decide
 * between rendering empty UI and a toast / inline error.
 */
export function isEmptyResult(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { kind?: string };
  return e.kind === "not_found" || e.kind === "not_yet_supported";
}

/**
 * `offline` and `timeout` are transient — the right UI is "memory layer
 * unavailable, click to retry". Use this to gate retry affordances.
 */
export function isTransientError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { kind?: string };
  return e.kind === "offline" || e.kind === "timeout";
}
