// Pulse outcome — the typed result of a runWorkflow() invocation.
//
// Three-state model (plus the ready/success state) replaces the old binary
// "either RunResult or thrown Error" shape. See tasks/pulse-outcome-states.md
// for the full state matrix and aggregation rules.
//
// This module is types-only. The classifier that produces SourceKindStatus
// lives in sourceDiagnostic.ts; the function that returns PulseOutcome is
// runWorkflow in pipeline.ts.

import type { SourceErrorKind } from "./sourceDiagnostic";

export type IntegrationKind = "slack" | "github" | "gitlab" | "jira" | "linear";

/** What the [Fix in …] button does, if anything. */
export type FixAction = "settings" | "invite_bot" | "renew_token";

/**
 * One row per integration kind in the pulse outcome. Pipeline aggregates
 * per-source results (e.g., 9 individual Slack channels) into ONE entry per
 * kind via the rules in tasks/pulse-outcome-states.md.
 */
export type SourceKindStatus = { kind: IntegrationKind; sourceCount: number } & (
  | { status: "ok_data"; itemCount: number }
  | { status: "ok_empty"; detail: string }
  | {
      status: "error";
      errorKind: SourceErrorKind;
      detail: string;
      fixAction?: FixAction;
      failedCount: number;
    }
);

/**
 * The terminal result of runWorkflow(). Replaces the old { RunResult | thrown }
 * dual-shape. Only `no_sources_configured` still throws (covered by the
 * existing error path at pipeline.ts:514, untouched by this plan).
 */
export type PulseOutcome =
  | {
      kind: "ready";
      sessionId: number;
      outputPath: string;
      markdown: string;
      costUsd: number;
      sources: SourceKindStatus[];
      windowDays: number;
    }
  | { kind: "empty"; sources: SourceKindStatus[]; windowDays: number }
  | {
      kind: "partial_failure";
      sources: SourceKindStatus[];
      windowDays: number;
    }
  | {
      kind: "total_failure";
      sources: SourceKindStatus[];
      windowDays: number;
    };
