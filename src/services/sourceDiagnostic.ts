// sourceDiagnostic — translate raw fetcher errors into user-language detail
// strings, plus the empty-state copy table and the telemetry summarizer.
//
// Why this lives here, separate from each service:
// ----------------------------------------------------
// `runWorkflow` in pipeline.ts catches errors thrown by slack.ts / github.ts /
// jira.ts / linear.ts and needs to render them to the user. Putting the
// error-classification regexes inside each service would scatter the copy
// across four files and force every UI surface that wants to render a fetch
// error to re-implement the same string-grep. One place, one source of truth.
//
// Coupling note: this module greps the Error("…") strings produced by the four
// fetcher services. Those strings are now semi-public API. Each service has a
// matching comment at the top — changing the throw format requires updating
// the regexes here. See ADAPTERS below.
//
// The token scrubber is load-bearing for security: error strings can echo
// bearer tokens (Authorization headers, query-string credentials, GraphQL
// payloads with tokens in variables). `classifyError` runs every raw message
// through `scrubSecrets` BEFORE truncating to 80 chars, so the user never
// sees a token in copy/paste-able form.

import type { IntegrationKind, FixAction } from "./pulseOutcome";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SourceErrorKind =
  | "not_in_channel"
  | "missing_scope"
  | "invalid_auth"
  | "unauthorized"
  | "rate_limited"
  | "project_not_found"
  | "network"
  | "mixed"
  | "unknown";

export interface ClassifiedError {
  errorKind: SourceErrorKind;
  /** User-language, single-line. Safe to render in chrome (no tokens). */
  detail: string;
  /** What the [Fix in …] button should do, if anything. */
  fixAction?: FixAction;
}

// ---------------------------------------------------------------------------
// Token scrubber
// ---------------------------------------------------------------------------
//
// Patterns ordered from most-specific to most-generic. The Bearer/JWT generic
// patterns are last so a service-specific token (xoxb-, ghp_, etc) is
// recognized for what it is in logs and not just clobbered as "[redacted]"
// from the Bearer match. (The output is the same string either way, but the
// ordering keeps mental-model clear.)

const SCRUBBER_PATTERNS: RegExp[] = [
  // Slack tokens (bot, user, app-level, refresh, legacy). Slack token format:
  // <prefix>-<numeric>-<numeric>-<alphanum>. Match generously to catch
  // anything that LOOKS like a Slack token even if the format drifts.
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  // GitHub PATs (classic + fine-grained) and OAuth tokens.
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bgho_[A-Za-z0-9]{20,}/g,
  /\bghu_[A-Za-z0-9]{20,}/g,
  /\bghs_[A-Za-z0-9]{20,}/g,
  /\bghr_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  // GitLab token prefixes: glpat (PAT), glsat (group/project access token),
  // glptt (pipeline trigger), gloas (OAuth app secret), glrt (refresh).
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bglsat-[A-Za-z0-9_-]{20,}/g,
  /\bglptt-[A-Za-z0-9_-]{20,}/g,
  /\bgloas-[A-Za-z0-9_-]{20,}/g,
  /\bglrt-[A-Za-z0-9_-]{20,}/g,
  // Linear API keys.
  /\blin_api_[A-Za-z0-9]{20,}/g,
  // JWT triplet (header.payload.signature, base64url segments).
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  // Generic Bearer token in an Authorization-style context. Matches the
  // word and whatever non-whitespace follows.
  /\bBearer\s+[^\s]+/gi,
];

export function scrubSecrets(input: string): string {
  let out = input;
  for (const re of SCRUBBER_PATTERNS) {
    out = out.replace(re, "[redacted]");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-source classifier — adapter table
// ---------------------------------------------------------------------------

interface Matcher {
  // Substring or regex test against the raw message (lowercased).
  test: (lowerMsg: string) => boolean;
  errorKind: SourceErrorKind;
  detail: string;
  fixAction?: FixAction;
}

const SLACK_MATCHERS: Matcher[] = [
  {
    test: (m) => m.includes("not_in_channel"),
    errorKind: "not_in_channel",
    detail: "bot not in channel — invite @Keepr to each",
    fixAction: "invite_bot",
  },
  {
    test: (m) => m.includes("missing_scope") || m.includes("channels:read"),
    errorKind: "missing_scope",
    detail: "missing scope — reinstall with updated manifest",
    fixAction: "settings",
  },
  {
    test: (m) =>
      m.includes("invalid_auth") ||
      m.includes("not_authed") ||
      m.includes("token_revoked"),
    errorKind: "invalid_auth",
    detail: "token rejected — paste a fresh one",
    fixAction: "renew_token",
  },
];

const GITLAB_MATCHERS: Matcher[] = [
  {
    test: (m) =>
      m.includes("401") ||
      m.includes("unauthorized") ||
      m.includes("invalid_token") ||
      m.includes("invalid token"),
    errorKind: "unauthorized",
    detail: "token rejected or expired",
    fixAction: "renew_token",
  },
  {
    test: (m) =>
      m.includes("403") ||
      m.includes("insufficient_scope") ||
      m.includes("insufficient scope") ||
      m.includes("forbidden"),
    errorKind: "missing_scope",
    detail: "missing scope — paste a token with api, read_user, read_repository",
    fixAction: "renew_token",
  },
  {
    test: (m) =>
      m.includes("404") ||
      m.includes("not found"),
    errorKind: "project_not_found",
    detail: "project no longer accessible — re-pick in Settings",
    fixAction: "settings",
  },
  {
    test: (m) =>
      m.includes("429") ||
      m.includes("rate limit") ||
      m.includes("rate_limit") ||
      m.includes("too many requests"),
    errorKind: "rate_limited",
    detail: "GitLab rate limit — wait a few minutes",
  },
];

const GITHUB_MATCHERS: Matcher[] = [
  {
    test: (m) =>
      m.includes("401") ||
      m.includes("bad credentials") ||
      m.includes("unauthorized"),
    errorKind: "unauthorized",
    detail: "token rejected or expired",
    fixAction: "renew_token",
  },
  {
    test: (m) =>
      m.includes("429") ||
      m.includes("rate limit") ||
      m.includes("rate_limit"),
    errorKind: "rate_limited",
    detail: "GitHub rate limit — wait a few minutes",
  },
];

const JIRA_MATCHERS: Matcher[] = [
  {
    test: (m) => m.includes("401") || m.includes("unauthorized"),
    errorKind: "unauthorized",
    detail: "token rejected or expired",
    fixAction: "renew_token",
  },
  {
    test: (m) =>
      m.includes("404") ||
      m.includes("410") ||
      m.includes("not found") ||
      m.includes("gone"),
    errorKind: "project_not_found",
    detail: "project no longer accessible — re-pick in Settings",
    fixAction: "settings",
  },
];

const LINEAR_MATCHERS: Matcher[] = [
  {
    test: (m) =>
      m.includes("authentication failed") ||
      m.includes("authentication required") ||
      m.includes("unauthorized") ||
      m.includes("401"),
    errorKind: "unauthorized",
    detail: "API key rejected — paste a fresh one",
    fixAction: "renew_token",
  },
];

// Network-error hints common to all four. A fetch that fails before HTTP
// throws TypeError/AbortError; we filter abort upstream, so anything else
// with these markers is genuinely a network problem.
const NETWORK_MATCHERS: Matcher[] = [
  {
    test: (m) =>
      m.includes("failed to fetch") ||
      m.includes("network request failed") ||
      m.includes("network error") ||
      m.includes("enotfound") ||
      m.includes("econnrefused") ||
      m.includes("etimedout"),
    errorKind: "network",
    detail: "network offline",
  },
];

const ADAPTERS: Record<IntegrationKind, Matcher[]> = {
  slack: [...SLACK_MATCHERS, ...NETWORK_MATCHERS],
  github: [...GITHUB_MATCHERS, ...NETWORK_MATCHERS],
  gitlab: [...GITLAB_MATCHERS, ...NETWORK_MATCHERS],
  jira: [...JIRA_MATCHERS, ...NETWORK_MATCHERS],
  linear: [...LINEAR_MATCHERS, ...NETWORK_MATCHERS],
};

// ---------------------------------------------------------------------------
// classifyError — the public entry point
// ---------------------------------------------------------------------------

const UNKNOWN_DETAIL_MAX_LEN = 80;

export function classifyError(
  source: IntegrationKind,
  err: unknown
): ClassifiedError {
  const raw = err instanceof Error ? err.message : String(err);
  // Scrub BEFORE classification so a token-bearing string doesn't sneak
  // into the unknown-fallback detail. Lowercase a separate copy for matching;
  // the user-facing detail strings are pre-baked and never include the raw.
  const scrubbed = scrubSecrets(raw);
  const lower = scrubbed.toLowerCase();

  for (const matcher of ADAPTERS[source]) {
    if (matcher.test(lower)) {
      return {
        errorKind: matcher.errorKind,
        detail: matcher.detail,
        fixAction: matcher.fixAction,
      };
    }
  }

  // Unknown — surface the scrubbed raw text (truncated). Defensible because
  // the user can Google the string; alternative ("something went wrong")
  // teaches nothing.
  const truncated =
    scrubbed.length > UNKNOWN_DETAIL_MAX_LEN
      ? scrubbed.slice(0, UNKNOWN_DETAIL_MAX_LEN - 1) + "…"
      : scrubbed;
  return {
    errorKind: "unknown",
    detail: truncated,
    fixAction: "settings",
  };
}

// ---------------------------------------------------------------------------
// describeEmpty — single source of truth for empty-state copy.
// ---------------------------------------------------------------------------

const EMPTY_COPY: Record<IntegrationKind, string> = {
  github: "no PRs in window",
  gitlab: "no MRs in window",
  slack: "no messages",
  jira: "no updates",
  linear: "no issues",
};

export function describeEmpty(kind: IntegrationKind): string {
  return EMPTY_COPY[kind];
}

// ---------------------------------------------------------------------------
// summarizeSources — one-line telemetry. Stable format so log analysis can
// regex it. Don't reformat without updating downstream consumers.
// ---------------------------------------------------------------------------

interface SourceLike {
  kind: IntegrationKind;
  status: "ok_data" | "ok_empty" | "error";
  itemCount?: number;
  errorKind?: SourceErrorKind;
  failedCount?: number;
}

export function summarizeSources(sources: SourceLike[]): string {
  if (sources.length === 0) return "no sources";
  return sources
    .map((s) => {
      if (s.status === "ok_data") return `${s.kind}: ${s.itemCount ?? 0} items`;
      if (s.status === "ok_empty") return `${s.kind}: empty`;
      return `${s.kind}: error(${s.errorKind ?? "unknown"})${
        s.failedCount ? ` ×${s.failedCount}` : ""
      }`;
    })
    .join(", ");
}
