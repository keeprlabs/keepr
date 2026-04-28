// Updater singleton — one source of truth shared between <UpdateBanner>
// and the Settings App panel. Without this, both surfaces independently
// call check() + downloadAndInstall() and we end up downloading the
// same multi-MB bundle twice (or worse, racing two installs to the same
// temp dir).
//
// The state machine:
//
//   ┌───────┐  check()  ┌─────────┐  downloadAndInstall()  ┌─────────┐
//   │ idle  │──────────▶│ checking│───────────────────────▶│  ready  │
//   └───────┘           └─────────┘                        └─────────┘
//        │                   │                                 │
//        │                   ▼                                 ▼
//        │              ┌─────────┐                       relaunch()
//        └─────────────▶│fallback │
//                       └─────────┘
//
// Once we reach `ready`, no further check()/download() calls fire — we
// just stay in ready until the user clicks Restart and the app relaunches
// into the new version.
//
// `fallback` is the legacy GitHub-API path used when the plugin can't
// initialize (offline, signature failure, etc). It does not download —
// it just surfaces the "run brew upgrade" copy.

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { db } from "./db";
import { CURRENT_VERSION, isNewer } from "../lib/version";

export type UpdaterState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ready"; version: string; update: Update }
  | { kind: "fallback"; version: string }
  | { kind: "current" };

const FALLBACK_CACHE_MS = 24 * 60 * 60 * 1000;
const STALE_SESSION_MS = 60 * 60 * 1000; // 1h — protects against crashed pulses
const STORAGE_KEY = "keepr_update_check";
const TIMESTAMP_KEY = "keepr_update_check_ts";
const GITHUB_API = "https://api.github.com/repos/keeprlabs/keepr/releases/latest";

let state: UpdaterState = { kind: "idle" };
let inflight: Promise<UpdaterState> | null = null;
const subscribers = new Set<(s: UpdaterState) => void>();

export function getState(): UpdaterState {
  return state;
}

export function subscribe(fn: (s: UpdaterState) => void): () => void {
  subscribers.add(fn);
  fn(state);
  return () => {
    subscribers.delete(fn);
  };
}

function setState(next: UpdaterState): void {
  state = next;
  for (const fn of subscribers) fn(state);
}

/**
 * Run a check + (if newer) silent download. Concurrent callers share the
 * same in-flight promise. If the state is already `ready`, returns
 * immediately — no re-checking, no re-downloading.
 *
 * @param force when true, bypasses the "already ready" short-circuit so a
 *              user clicking "Check for updates" gets a fresh probe.
 */
export function checkForUpdate(opts: { force?: boolean } = {}): Promise<UpdaterState> {
  // Already done — short-circuit. No re-check, no re-download.
  if (state.kind === "ready") return Promise.resolve(state);
  // Already in flight — return the same promise so concurrent callers share work.
  if (inflight) return inflight;

  // Set inflight synchronously so a second call entering before the first
  // even starts its awaits hits the dedup branch above. Without this, each
  // caller would race its own session-check + check() pair.
  inflight = (async (): Promise<UpdaterState> => {
    try {
      if (!opts.force && (await isSessionRunning())) {
        return state; // defer entirely while a pulse is processing
      }
      setState({ kind: "checking" });
      try {
        const update = await check();
        if (!update || !isNewer(update.version, CURRENT_VERSION)) {
          setState({ kind: "current" });
          recordTimestamp();
          return state;
        }
        // Silent download — banner only appears once the bundle is ready.
        await update.downloadAndInstall();
        setState({ kind: "ready", version: update.version, update });
        recordTimestamp();
        return state;
      } catch (err) {
        console.warn("Updater plugin check failed; falling back to GitHub poll:", err);
        const fallbackVersion = await pollGitHubReleases();
        if (fallbackVersion && isNewer(fallbackVersion, CURRENT_VERSION)) {
          setState({ kind: "fallback", version: fallbackVersion });
        } else {
          setState({ kind: "current" });
        }
        recordTimestamp();
        return state;
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function getLastCheckedAt(): number | null {
  try {
    const raw = localStorage.getItem(TIMESTAMP_KEY);
    return raw ? Number.parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

function recordTimestamp(): void {
  try {
    localStorage.setItem(TIMESTAMP_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

async function pollGitHubReleases(): Promise<string | null> {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const data = JSON.parse(cached) as { checkedAt?: number; latestVersion?: string | null };
      if (data.checkedAt && Date.now() - data.checkedAt < FALLBACK_CACHE_MS) {
        return data.latestVersion ?? null;
      }
    }
  } catch {
    /* bad cache — fall through */
  }
  try {
    const response = await tauriFetch(GITHUB_API, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Keepr-Desktop",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: string };
    const version = data.tag_name?.replace(/^v/, "") || null;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ checkedAt: Date.now(), latestVersion: version })
    );
    return version;
  } catch {
    return null;
  }
}

/**
 * A pulse is "running" only if at least one session is in 'processing'
 * AND was created within the staleness window. Older rows are treated as
 * crashed pulses — without this, a single crash permanently blocks
 * updates for that user.
 */
async function isSessionRunning(): Promise<boolean> {
  try {
    const d = await db();
    const cutoff = new Date(Date.now() - STALE_SESSION_MS).toISOString();
    const rows = await d.select<Array<{ cnt: number }>>(
      "SELECT COUNT(*) as cnt FROM sessions WHERE status = 'processing' AND created_at > ?",
      [cutoff]
    );
    return (rows[0]?.cnt ?? 0) > 0;
  } catch {
    return false;
  }
}

// Test helper — resets the singleton between tests.
export function _resetForTests(): void {
  state = { kind: "idle" };
  inflight = null;
  subscribers.clear();
}
