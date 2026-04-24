// The shared data pipeline that both workflows (team pulse + 1:1 prep) run
// through. Follows the design doc exactly:
//
//   fetch -> deterministic prune -> haiku per-channel map -> sonnet reduce
//
// Evidence items are assigned stable `ev_N` ids the LLM can cite. The app
// owns the id -> url mapping; the LLM never sees URLs.

import teamPulsePrompt from "../prompts/team_pulse.md?raw";
import onePrepPrompt from "../prompts/one_on_one_prep.md?raw";
import weeklyUpdatePrompt from "../prompts/weekly_eng_update.md?raw";
import perfEvalPrompt from "../prompts/perf_evaluation.md?raw";
import promoReadyPrompt from "../prompts/promo_readiness.md?raw";
import haikuPrompt from "../prompts/haiku_channel_summary.md?raw";

import type {
  EvidencePromptItem,
  EvidenceSource,
  TeamMember,
  WorkflowType,
} from "../lib/types";
import {
  createSession,
  deleteSession,
  getConfig,
  insertEvidence,
  insertPersonFacts,
  listMembers,
  setSessionStatus,
  updateSession,
} from "./db";
import { fetchRepoActivity, type FetchedPR } from "./github";
import {
  fetchProjectActivity as fetchGitLabProjectActivity,
  type FetchedGitLabMR,
} from "./gitlab";
import {
  fetchChannelHistory,
  authTest as slackAuthTest,
  type FetchedMessage,
} from "./slack";
import { fetchProjectActivity, type FetchedJiraIssue } from "./jira";
import { fetchTeamActivity, type FetchedLinearIssue } from "./linear";
import { getProvider, setCustomConfig } from "./llm";
import { writeMemory, readMemoryContext } from "./memory";
import { throwIfAborted, isAbortError } from "../lib/abort";
import { info as logInfo, warn as logWarn } from "@tauri-apps/plugin-log";
import {
  classifyError,
  describeEmpty,
  summarizeSources,
  type SourceErrorKind,
} from "./sourceDiagnostic";
import type {
  FixAction,
  IntegrationKind,
  PulseOutcome,
  SourceKindStatus,
} from "./pulseOutcome";

export type { PulseOutcome, SourceKindStatus } from "./pulseOutcome";

// ---- Normalization -------------------------------------------------------

export interface NormalizedItem {
  source: EvidenceSource;
  source_id: string;
  source_url: string;
  timestamp_at: string;
  content: string;
  actor_slack: string | null;
  actor_github: string | null;
  actor_gitlab: string | null;
  actor_jira: string | null;
  actor_linear: string | null;
  /** pipeline grouping: "repo:<path>", "project:<path>", "slack:<channel>", "jira:<project>", "linear:<team>" */
  bucket: string;
}

/** Truncate a string without splitting UTF-16 surrogate pairs. */
function safeSlice(s: string, start: number, end: number): string {
  const sliced = s.slice(start, end);
  // If the last char is a leading surrogate (0xD800–0xDBFF), drop it.
  if (sliced.length > 0) {
    const last = sliced.charCodeAt(sliced.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      return sliced.slice(0, -1);
    }
  }
  return sliced;
}

function normalizeGithub(prs: FetchedPR[], repoFull: string): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const pr of prs) {
    const body = pr.body ? safeSlice(pr.body, 0, 1200) : "";
    out.push({
      source: "github_pr",
      source_id: pr.source_id,
      source_url: pr.url,
      timestamp_at: pr.updated_at,
      content: `PR ${pr.source_id}: ${pr.title}\n\n${body}`.trim(),
      actor_slack: null,
      actor_github: pr.user || null,
      actor_gitlab: null,
      actor_jira: null,
      actor_linear: null,
      bucket: `repo:${repoFull}`,
    });
    for (const rv of pr.reviews) {
      const rvBody = (rv.body || "").trim();
      if (!rvBody) continue;
      out.push({
        source: "github_review",
        source_id: rv.source_id,
        source_url: rv.url,
        timestamp_at: rv.submitted_at,
        content: `Review on ${pr.source_id} (${rv.state}): ${safeSlice(rvBody, 0, 600)}`,
        actor_slack: null,
        actor_github: rv.user || null,
        actor_gitlab: null,
        actor_jira: null,
        actor_linear: null,
        bucket: `repo:${repoFull}`,
      });
    }
  }
  return out;
}

function normalizeGitlab(
  mrs: FetchedGitLabMR[],
  pathWithNamespace: string
): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const mr of mrs) {
    const body = mr.body ? safeSlice(mr.body, 0, 1200) : "";
    out.push({
      source: "gitlab_mr",
      source_id: mr.source_id,
      source_url: mr.url,
      timestamp_at: mr.updated_at,
      content: `MR ${mr.source_id}: ${mr.title}\n\n${body}`.trim(),
      actor_slack: null,
      actor_github: null,
      actor_gitlab: mr.user || null,
      actor_jira: null,
      actor_linear: null,
      bucket: `project:${pathWithNamespace}`,
    });
    for (const rv of mr.reviews) {
      const rvBody = (rv.body || "").trim();
      // Approvals emit with null body — still surface them as structured
      // evidence (state=APPROVED is itself informative).
      const contentBody = rvBody ? safeSlice(rvBody, 0, 600) : "(approved)";
      out.push({
        source: "gitlab_review",
        source_id: rv.source_id,
        source_url: rv.url,
        timestamp_at: rv.submitted_at,
        content: `Review on ${mr.source_id} (${rv.state}): ${contentBody}`,
        actor_slack: null,
        actor_github: null,
        actor_gitlab: rv.user || null,
        actor_jira: null,
        actor_linear: null,
        bucket: `project:${pathWithNamespace}`,
      });
    }
  }
  return out;
}

function normalizeSlack(msgs: FetchedMessage[]): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const m of msgs) {
    out.push({
      source: "slack_message",
      source_id: m.source_id,
      source_url: m.url,
      timestamp_at: new Date(Number(m.ts) * 1000).toISOString(),
      content: `#${m.channel_name}: ${m.text}`,
      actor_slack: m.user,
      actor_github: null,
      actor_gitlab: null,
      actor_jira: null,
      actor_linear: null,
      bucket: `slack:${m.channel_name}`,
    });
    for (const r of m.replies || []) {
      out.push({
        source: "slack_message",
        source_id: r.source_id,
        source_url: r.url,
        timestamp_at: new Date(Number(r.ts) * 1000).toISOString(),
        content: `#${m.channel_name} (thread): ${r.text}`,
        actor_slack: r.user,
        actor_github: null,
        actor_gitlab: null,
        actor_jira: null,
        actor_linear: null,
        bucket: `slack:${m.channel_name}`,
      });
    }
  }
  return out;
}

function normalizeJira(issues: FetchedJiraIssue[], projectKey: string): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const issue of issues) {
    const body = issue.description ? safeSlice(issue.description, 0, 1200) : "";
    out.push({
      source: "jira_issue",
      source_id: issue.source_id,
      source_url: issue.url,
      timestamp_at: issue.updated,
      content: `${issue.key}: ${issue.summary} [${issue.status}]\n\n${body}`.trim(),
      actor_slack: null,
      actor_github: null,
      actor_gitlab: null,
      actor_jira: issue.assignee || issue.reporter || null,
      actor_linear: null,
      bucket: `jira:${projectKey}`,
    });
    for (const c of issue.comments) {
      out.push({
        source: "jira_comment",
        source_id: c.source_id,
        source_url: c.url,
        timestamp_at: c.created,
        content: `Comment on ${issue.key} by ${c.author || "someone"}: ${safeSlice(c.body, 0, 600)}`,
        actor_slack: null,
        actor_github: null,
        actor_gitlab: null,
        actor_jira: c.author || null,
        actor_linear: null,
        bucket: `jira:${projectKey}`,
      });
    }
  }
  return out;
}

function normalizeLinear(issues: FetchedLinearIssue[], teamKey: string): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const issue of issues) {
    const body = issue.description ? safeSlice(issue.description, 0, 1200) : "";
    out.push({
      source: "linear_issue",
      source_id: issue.source_id,
      source_url: issue.url,
      timestamp_at: issue.updatedAt,
      content: `${issue.identifier}: ${issue.title} [${issue.state}]\n\n${body}`.trim(),
      actor_slack: null,
      actor_github: null,
      actor_gitlab: null,
      actor_jira: null,
      actor_linear: issue.assignee || issue.creator || null,
      bucket: `linear:${teamKey}`,
    });
    for (const c of issue.comments) {
      out.push({
        source: "linear_comment",
        source_id: c.source_id,
        source_url: c.url,
        timestamp_at: c.createdAt,
        content: `Comment on ${issue.identifier} by ${c.author || "someone"}: ${safeSlice(c.body, 0, 600)}`,
        actor_slack: null,
        actor_github: null,
        actor_gitlab: null,
        actor_jira: null,
        actor_linear: c.author || null,
        bucket: `linear:${teamKey}`,
      });
    }
  }
  return out;
}

// ---- Deterministic pruning (no LLM) --------------------------------------

const TRIVIAL = new Set(["lgtm", "approved", "ty", "thanks", "thx", ":+1:", "+1", "ok", "nice", "cool", "👍"]);

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function prune(items: NormalizedItem[]): NormalizedItem[] {
  // Drop trivial/noise, dedupe by content hash, cap per bucket.
  const seen = new Set<string>();
  const kept: NormalizedItem[] = [];

  for (const it of items) {
    const body = it.content.replace(/\s+/g, " ").trim();
    if (!body) continue;

    if (it.source === "slack_message") {
      // Drop super-short noise.
      const stripped = body.replace(/#[\w-]+:\s*/, "").replace(/<[^>]+>/g, "");
      if (wordCount(stripped) < 5) continue;
      if (TRIVIAL.has(stripped.toLowerCase())) continue;
    }

    if (it.source === "github_review") {
      const low = body.toLowerCase();
      if (low.endsWith("lgtm") || low.endsWith("approved") || wordCount(body) < 4) {
        continue;
      }
    }

    // Jira/Linear comments: drop very short noise
    if (it.source === "jira_comment" || it.source === "linear_comment") {
      const stripped = body.replace(/^Comment on [A-Z]+-\d+[^:]*:\s*/, "");
      if (wordCount(stripped) < 5) continue;
    }

    const key = `${it.source}:${safeSlice(body, 0, 240)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(it);
  }

  // Per-bucket FIFO caps.
  const bucketCounts = new Map<string, number>();
  const final: NormalizedItem[] = [];
  // Iterate newest-first so the cap drops the OLDEST over the cap.
  const sorted = [...kept].sort((a, b) =>
    b.timestamp_at.localeCompare(a.timestamp_at)
  );
  for (const it of sorted) {
    const cap = it.bucket.startsWith("repo:") ? 200
      : it.bucket.startsWith("jira:") || it.bucket.startsWith("linear:") ? 300
      : 500;
    const n = bucketCounts.get(it.bucket) || 0;
    if (n >= cap) continue;
    bucketCounts.set(it.bucket, n + 1);
    final.push(it);
  }
  // Restore chronological order.
  final.sort((a, b) => a.timestamp_at.localeCompare(b.timestamp_at));
  return final;
}

// ---- Actor resolution ----------------------------------------------------

function resolveActor(
  item: NormalizedItem,
  members: TeamMember[]
): TeamMember | null {
  if (item.actor_github) {
    const m = members.find(
      (x) => (x.github_handle || "").toLowerCase() === item.actor_github!.toLowerCase()
    );
    if (m) return m;
  }
  if (item.actor_gitlab) {
    const m = members.find(
      (x) => (x.gitlab_username || "").toLowerCase() === item.actor_gitlab!.toLowerCase()
    );
    if (m) return m;
  }
  if (item.actor_slack) {
    const slackId = item.actor_slack.trim().toUpperCase();
    const m = members.find(
      (x) => (x.slack_user_id || "").trim().toUpperCase() === slackId
    );
    if (m) return m;
  }
  if (item.actor_jira) {
    // Jira actor is display name — match against jira_username or display_name
    const low = item.actor_jira.toLowerCase();
    const m = members.find(
      (x) => (x.jira_username || "").toLowerCase() === low
        || x.display_name.toLowerCase() === low
    );
    if (m) return m;
  }
  if (item.actor_linear) {
    // Linear actor is display name — match against linear_username or display_name
    const low = item.actor_linear.toLowerCase();
    const m = members.find(
      (x) => (x.linear_username || "").toLowerCase() === low
        || x.display_name.toLowerCase() === low
    );
    if (m) return m;
  }
  return null;
}

// ---- Haiku per-bucket map ------------------------------------------------

function buildEvidenceJson(
  items: Array<{ idNum: number; actor: TeamMember | null; item: NormalizedItem }>,
  members: TeamMember[],
  timeRange: { start: string; end: string },
  workflow: WorkflowType
): string {
  const evidence: EvidencePromptItem[] = items.map(({ idNum, actor, item }) => ({
    id: `ev_${idNum}`,
    source: item.source,
    actor_id: actor ? `tm_${actor.id}` : null,
    timestamp: item.timestamp_at,
    url: item.source_url, // Haiku only; Sonnet will NOT receive urls in the final reduce
    content: item.content,
  }));
  return JSON.stringify(
    {
      workflow,
      time_range: timeRange,
      team: members.map((m) => ({ id: `tm_${m.id}`, display_name: m.display_name })),
      evidence,
    },
    null,
    2
  );
}

// ---- Main pipeline -------------------------------------------------------

export interface RunOptions {
  workflow: WorkflowType;
  targetMemberId?: number | null;
  daysBack: number;
  forceRefresh?: boolean;
  onProgress?: (stage: string, detail?: string) => void;
  // When set, the pipeline checks signal.aborted at every loop boundary
  // and passes the signal down to every HTTP call. On abort the session
  // row is DELETED (not marked failed) so cancelled runs don't clutter
  // the sidebar. See src/lib/abort.ts.
  signal?: AbortSignal;
}

export interface RunResult {
  sessionId: number;
  outputPath: string;
  markdown: string;
  costUsd: number;
}

// Narrow `unknown` error values to a readable string for logs.
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---- Per-source result tracking + aggregation ----------------------------
//
// During the fetch loop we record one SourceResult per source instance
// (channel/repo/project/team). After the loop we collapse to ONE
// SourceKindStatus per integration kind via the rules in
// tasks/pulse-outcome-states.md. Per-source granularity stays in `logWarn`
// for debugging; the UI only ever sees the per-kind rollup.

type SourceResult =
  | { kind: IntegrationKind; status: "ok_data"; itemCount: number }
  | { kind: IntegrationKind; status: "ok_empty" }
  | {
      kind: IntegrationKind;
      status: "error";
      errorKind: SourceErrorKind;
      detail: string;
      fixAction?: FixAction;
    };

const ALL_KINDS: IntegrationKind[] = ["github", "gitlab", "slack", "jira", "linear"];

function aggregateByKind(
  results: SourceResult[],
  kindCounts: Record<IntegrationKind, number>
): SourceKindStatus[] {
  const out: SourceKindStatus[] = [];
  for (const kind of ALL_KINDS) {
    const sourceCount = kindCounts[kind];
    if (sourceCount === 0) continue; // user has no sources of this kind — skip
    const subset = results.filter((r) => r.kind === kind);
    out.push(aggregateOneKind(kind, sourceCount, subset));
  }
  return out;
}

function aggregateOneKind(
  kind: IntegrationKind,
  sourceCount: number,
  subset: SourceResult[]
): SourceKindStatus {
  // Rule 1: any source returned data → kind is ok_data with sum of items.
  // Rule 4 fold-in: data wins even if siblings errored. Errors stay in logWarn.
  const dataResults = subset.filter((r) => r.status === "ok_data");
  if (dataResults.length > 0) {
    const itemCount = dataResults.reduce(
      (sum, r) => sum + (r.status === "ok_data" ? r.itemCount : 0),
      0
    );
    return { kind, sourceCount, status: "ok_data", itemCount };
  }

  // No data. Look for errors.
  const errors = subset.filter(
    (r): r is Extract<SourceResult, { status: "error" }> => r.status === "error"
  );
  if (errors.length === 0) {
    // Rule 2: all sources succeeded but returned 0 items.
    return { kind, sourceCount, status: "ok_empty", detail: describeEmpty(kind) };
  }

  // Rule 3: at least one error, no data. Aggregate the error.
  const firstKind = errors[0].errorKind;
  const allSameKind = errors.every((e) => e.errorKind === firstKind);
  if (allSameKind) {
    return {
      kind,
      sourceCount,
      status: "error",
      errorKind: firstKind,
      detail: errors[0].detail,
      fixAction: errors[0].fixAction,
      failedCount: errors.length,
    };
  }
  // Mixed errors within one kind. Defensive copy — happens when e.g. some
  // Slack channels return not_in_channel and others return invalid_auth.
  return {
    kind,
    sourceCount,
    status: "error",
    errorKind: "mixed",
    detail: `${errors.length} sources failed — check Settings`,
    fixAction: "settings",
    failedCount: errors.length,
  };
}

function classifyOutcomeKind(
  sources: SourceKindStatus[]
): "ready" | "empty" | "partial_failure" | "total_failure" {
  if (sources.some((s) => s.status === "ok_data")) return "ready";
  const hasError = sources.some((s) => s.status === "error");
  const hasEmpty = sources.some((s) => s.status === "ok_empty");
  if (hasError && !hasEmpty) return "total_failure";
  if (hasError && hasEmpty) return "partial_failure";
  return "empty"; // all configured kinds returned ok_empty
}

export async function runWorkflow(opts: RunOptions): Promise<PulseOutcome> {
  // Tee progress events into the log file so every fetch / prune / map /
  // synthesize / write step is visible in the platform log dir — makes
  // silent fetch failures diagnosable via `tail -f`.
  const progress = (stage: string, detail?: string) => {
    logInfo(`${stage}${detail ? ": " + detail : ""}`).catch(() => {});
    opts.onProgress?.(stage, detail);
  };
  const cfg = await getConfig();
  const members = await listMembers();

  const end = new Date();
  const start = new Date(end.getTime() - opts.daysBack * 24 * 3600 * 1000);
  const timeRange = { start: start.toISOString(), end: end.toISOString() };

  const needsTarget = ["one_on_one_prep", "perf_evaluation", "promo_readiness"].includes(opts.workflow);
  const target =
    needsTarget && opts.targetMemberId
      ? members.find((m) => m.id === opts.targetMemberId) || null
      : null;

  const sessionId = await createSession({
    workflow_type: opts.workflow,
    target_member_id: target?.id ?? null,
    time_range_start: timeRange.start,
    time_range_end: timeRange.end,
  });

  try {
    await setSessionStatus(sessionId, "processing");

    // ---- Fetch ----
    progress("fetch", "Loading Slack channels & GitHub repos");

    const allItems: NormalizedItem[] = [];

    // Per-source results accumulated alongside `allItems`. Each fetcher
    // try/catch records exactly one entry. After the loop we collapse to
    // SourceKindStatus[] for the outcome. Subsumes the prior `fetchErrors`
    // accumulator (commit 50af362) — classifyError gives us a typed error
    // record per source, the simple string list is no longer needed.
    const perSource: SourceResult[] = [];

    // Each new session fetches the full time range — the incremental
    // cache is skipped (forceRefresh: true). The cache was causing
    // second-run failures: the first run advanced the cursor to "now",
    // and the second run fetched only items after "now" → zero items.
    // The cache is valuable for retry-within-a-session (not yet built),
    // not for blocking fresh sessions from seeing the full window.
    //
    // `signal` flows into each fetch helper so HTTP calls abort mid-flight
    // on user cancel. Every inner catch re-throws `isAbortError(err)` so
    // a cancelled run doesn't get silently reduced to "that source failed,
    // let's try the next one". See src/lib/abort.ts.
    const fetchOpts = { forceRefresh: true, signal: opts.signal };

    // GitHub
    for (const repo of cfg.selected_github_repos) {
      throwIfAborted(opts.signal);
      progress("fetch", `GitHub: ${repo.owner}/${repo.repo}`);
      try {
        const prs = await fetchRepoActivity(
          repo.owner,
          repo.repo,
          timeRange.start,
          fetchOpts
        );
        progress("fetch", `GitHub: ${repo.owner}/${repo.repo} → ${prs.length} PRs`);
        allItems.push(...normalizeGithub(prs, `${repo.owner}/${repo.repo}`));
        perSource.push(
          prs.length === 0
            ? { kind: "github", status: "ok_empty" }
            : { kind: "github", status: "ok_data", itemCount: prs.length }
        );
      } catch (err) {
        if (isAbortError(err)) throw err;
        logWarn(`github fetch failed (${repo.owner}/${repo.repo}): ${errMessage(err)}`).catch(() => {});
        const c = classifyError("github", err);
        perSource.push({ kind: "github", status: "error", ...c });
      }
    }

    // GitLab
    for (const project of cfg.selected_gitlab_projects || []) {
      throwIfAborted(opts.signal);
      progress("fetch", `GitLab: ${project.path_with_namespace}`);
      try {
        const mrs = await fetchGitLabProjectActivity(
          project.id,
          project.path_with_namespace,
          timeRange.start,
          fetchOpts
        );
        progress(
          "fetch",
          `GitLab: ${project.path_with_namespace} → ${mrs.length} MRs`
        );
        allItems.push(...normalizeGitlab(mrs, project.path_with_namespace));
        perSource.push(
          mrs.length === 0
            ? { kind: "gitlab", status: "ok_empty" }
            : { kind: "gitlab", status: "ok_data", itemCount: mrs.length }
        );
      } catch (err) {
        if (isAbortError(err)) throw err;
        logWarn(
          `gitlab fetch failed (${project.path_with_namespace}): ${errMessage(err)}`
        ).catch(() => {});
        const c = classifyError("gitlab", err);
        perSource.push({ kind: "gitlab", status: "error", ...c });
      }
    }

    // Slack
    let teamDomain = "app";
    try {
      const info = await slackAuthTest();
      teamDomain = info.team.toLowerCase().replace(/[^a-z0-9-]/g, "");
    } catch (err) {
      if (isAbortError(err)) throw err;
      // ignore — if slack isn't connected we just skip
    }

    for (const ch of cfg.selected_slack_channels) {
      throwIfAborted(opts.signal);
      progress("fetch", `Slack: #${ch.name}`);
      try {
        const msgs = await fetchChannelHistory(
          ch,
          timeRange.start,
          teamDomain,
          fetchOpts
        );
        progress("fetch", `Slack: #${ch.name} → ${msgs.length} msgs`);
        allItems.push(...normalizeSlack(msgs));
        perSource.push(
          msgs.length === 0
            ? { kind: "slack", status: "ok_empty" }
            : { kind: "slack", status: "ok_data", itemCount: msgs.length }
        );
      } catch (err) {
        if (isAbortError(err)) throw err;
        logWarn(`slack fetch failed (#${ch.name}): ${errMessage(err)}`).catch(() => {});
        const c = classifyError("slack", err);
        perSource.push({ kind: "slack", status: "error", ...c });
      }
    }

    // Jira
    for (const proj of cfg.selected_jira_projects || []) {
      throwIfAborted(opts.signal);
      progress("fetch", `Jira: ${proj.key}`);
      try {
        const issues = await fetchProjectActivity(
          proj.key,
          timeRange.start,
          fetchOpts
        );
        progress("fetch", `Jira: ${proj.key} → ${issues.length} issues`);
        allItems.push(...normalizeJira(issues, proj.key));
        perSource.push(
          issues.length === 0
            ? { kind: "jira", status: "ok_empty" }
            : { kind: "jira", status: "ok_data", itemCount: issues.length }
        );
      } catch (err) {
        if (isAbortError(err)) throw err;
        logWarn(`jira fetch failed (${proj.key}): ${errMessage(err)}`).catch(() => {});
        const c = classifyError("jira", err);
        perSource.push({ kind: "jira", status: "error", ...c });
      }
    }

    // Linear
    for (const team of cfg.selected_linear_teams || []) {
      throwIfAborted(opts.signal);
      progress("fetch", `Linear: ${team.key}`);
      try {
        const issues = await fetchTeamActivity(
          team.id,
          team.key,
          timeRange.start,
          fetchOpts
        );
        progress("fetch", `Linear: ${team.key} → ${issues.length} issues`);
        allItems.push(...normalizeLinear(issues, team.key));
        perSource.push(
          issues.length === 0
            ? { kind: "linear", status: "ok_empty" }
            : { kind: "linear", status: "ok_data", itemCount: issues.length }
        );
      } catch (err) {
        if (isAbortError(err)) throw err;
        logWarn(`linear fetch failed (${team.key}): ${errMessage(err)}`).catch(() => {});
        const c = classifyError("linear", err);
        perSource.push({ kind: "linear", status: "error", ...c });
      }
    }

    throwIfAborted(opts.signal);
    progress("prune", `Pruning ${allItems.length} raw items`);

    // Pre-check: bail early with a specific message if no data sources
    // are configured at all. This is a configuration error, not a fetch
    // outcome — keeps throwing so the caller's existing error path fires.
    const kindCounts: Record<IntegrationKind, number> = {
      github: cfg.selected_github_repos.length,
      gitlab: (cfg.selected_gitlab_projects || []).length,
      slack: cfg.selected_slack_channels.length,
      jira: (cfg.selected_jira_projects || []).length,
      linear: (cfg.selected_linear_teams || []).length,
    };
    const hasAnySources =
      kindCounts.github +
        kindCounts.gitlab +
        kindCounts.slack +
        kindCounts.jira +
        kindCounts.linear >
      0;
    if (!hasAnySources) {
      throw new Error(
        "No data sources selected. Open Settings and connect at least one Slack channel, GitHub repo, GitLab project, Jira project, or Linear team."
      );
    }

    // Aggregate per-source → per-kind for the outcome shape.
    const aggregated = aggregateByKind(perSource, kindCounts);

    // Zero-items branch: classify and return a typed PulseOutcome. The old
    // behavior was a generic throw — see tasks/pulse-outcome-states.md for
    // the redesign and the per-outcome session lifecycle (D1).
    if (!allItems.length) {
      const outcomeKind = classifyOutcomeKind(aggregated);
      // Should never be "ready" here (we have no items), but TS-narrow it out.
      if (outcomeKind === "ready") {
        // Defensive: aggregator said data exists but allItems is empty.
        // Fall through to the throw below as a loud signal.
        throw new Error(
          "Internal: aggregator inconsistent with allItems — please report."
        );
      }
      const outcome: PulseOutcome = {
        kind: outcomeKind,
        sources: aggregated,
        windowDays: opts.daysBack,
      };
      logInfo(
        `pulse outcome: ${outcome.kind} — ${summarizeSources(outcome.sources)}`
      ).catch(() => {});

      // Session lifecycle (D1): empty deletes the row, total_failure marks
      // failed, partial_failure marks complete (some kinds did work, just
      // no items survived). See plan section "File-level changes".
      if (outcome.kind === "empty") {
        try {
          await deleteSession(sessionId);
        } catch (delErr) {
          console.warn("pipeline: failed to delete empty-outcome session row", delErr);
        }
      } else if (outcome.kind === "total_failure") {
        await setSessionStatus(
          sessionId,
          "failed",
          "Every source returned an error"
        );
      } else {
        // partial_failure — record was created, no output, but not a hard fail.
        await setSessionStatus(sessionId, "complete");
      }
      return outcome;
    }

    let pruned = prune(allItems);

    // Filter to team activity (and target engineer for 1:1 prep).
    // If NO items match any team member, log a diagnostic and fall through
    // with ALL pruned items rather than hard-failing. The LLM can still
    // produce useful output from unattributed activity — it just won't
    // reference specific team members in the memory deltas.
    const matched = pruned.filter((it) => {
      const actor = resolveActor(it, members);
      if (needsTarget && target) {
        return actor?.id === target.id || mentionedTarget(it, target);
      }
      return actor != null || mentionedAny(it, members);
    });

    if (matched.length) {
      pruned = matched;
    } else {
      // Log a diagnostic so the user can fix their mappings.
      const seenGh = new Set<string>();
      const seenGl = new Set<string>();
      const seenSlack = new Set<string>();
      const seenJira = new Set<string>();
      const seenLinear = new Set<string>();
      for (const it of pruned) {
        if (it.actor_github) seenGh.add(it.actor_github);
        if (it.actor_gitlab) seenGl.add(it.actor_gitlab);
        if (it.actor_slack) seenSlack.add(it.actor_slack);
        if (it.actor_jira) seenJira.add(it.actor_jira);
        if (it.actor_linear) seenLinear.add(it.actor_linear);
      }
      const configuredGh = members
        .filter((m) => m.github_handle)
        .map((m) => m.github_handle!);
      const configuredGl = members
        .filter((m) => m.gitlab_username)
        .map((m) => m.gitlab_username!);
      const configuredSlack = members
        .filter((m) => m.slack_user_id)
        .map((m) => m.slack_user_id!);
      const configuredJira = members
        .filter((m) => m.jira_username)
        .map((m) => m.jira_username!);
      const configuredLinear = members
        .filter((m) => m.linear_username)
        .map((m) => m.linear_username!);

      const diagnosticLines: string[] = [];
      if (seenGh.size || configuredGh.length) {
        diagnosticLines.push(
          `GitHub in data: ${[...seenGh].join(", ") || "(none)"} | configured: ${configuredGh.join(", ") || "(none)"}`
        );
      }
      if (seenGl.size || configuredGl.length) {
        diagnosticLines.push(
          `GitLab in data: ${[...seenGl].join(", ") || "(none)"} | configured: ${configuredGl.join(", ") || "(none)"}`
        );
      }
      if (seenSlack.size || configuredSlack.length) {
        diagnosticLines.push(
          `Slack in data: ${[...seenSlack].join(", ") || "(none)"} | configured: ${configuredSlack.join(", ") || "(none)"}`
        );
      }
      if (seenJira.size || configuredJira.length) {
        diagnosticLines.push(
          `Jira in data: ${[...seenJira].join(", ") || "(none)"} | configured: ${configuredJira.join(", ") || "(none)"}`
        );
      }
      if (seenLinear.size || configuredLinear.length) {
        diagnosticLines.push(
          `Linear in data: ${[...seenLinear].join(", ") || "(none)"} | configured: ${configuredLinear.join(", ") || "(none)"}`
        );
      }

      const diagnosticMsg =
        "No items matched team members. Using all activity (unattributed).\n" +
        diagnosticLines.join("\n") +
        "\nFix: update team member mappings in Settings.";

      // eslint-disable-next-line no-console
      console.warn(`[keepr] ${diagnosticMsg}`);
      // Surface the diagnostic to the UI via the prune stage detail.
      progress("prune", "No team member matches found. Check Settings.");
      // Keep all pruned items so the pipeline still produces output.
    }

    if (!pruned.length) {
      throw new Error(
        "No activity survived deterministic pruning. The selected repos/channels may have only bot messages or trivial content in this time range."
      );
    }

    // Assign stable ev_N ids and persist evidence rows.
    const withIds = pruned.map((item, i) => ({
      idNum: i + 1,
      actor: resolveActor(item, members),
      item,
    }));

    await insertEvidence(
      sessionId,
      withIds.map(({ item, actor }) => ({
        source: item.source,
        source_url: item.source_url,
        source_id: item.source_id,
        actor_member_id: actor?.id ?? null,
        timestamp_at: item.timestamp_at,
        content: item.content,
      }))
    );

    // Group by bucket for the map step.
    const buckets = new Map<string, typeof withIds>();
    for (const w of withIds) {
      const arr = buckets.get(w.item.bucket) || [];
      arr.push(w);
      buckets.set(w.item.bucket, arr);
    }

    // ---- Map (Haiku per bucket) ----
    throwIfAborted(opts.signal);
    if (cfg.llm_provider === "custom") {
      setCustomConfig({
        base_url: cfg.custom_llm_base_url,
        synthesis_model: cfg.custom_llm_synthesis_model,
        classifier_model: cfg.custom_llm_classifier_model,
      });
    }
    const provider = getProvider(cfg.llm_provider);
    progress("map", `Summarizing ${buckets.size} sources`);

    let totalInput = 0;
    let totalOutput = 0;
    let haikuFailed = false;
    const bucketSummaries: string[] = [];

    for (const [bucket, arr] of buckets) {
      throwIfAborted(opts.signal);
      const evidenceJson = buildEvidenceJson(arr, members, timeRange, opts.workflow);
      try {
        const r = await provider.complete({
          model: cfg.classifier_model,
          system: haikuPrompt,
          messages: [
            {
              role: "user",
              content: `Source bucket: ${bucket}\n\nEvidence JSON:\n\`\`\`json\n${evidenceJson}\n\`\`\``,
            },
          ],
          max_tokens: 600,
          temperature: 0.1,
          signal: opts.signal,
        });
        totalInput += r.input_tokens;
        totalOutput += r.output_tokens;
        const text = r.text.trim();
        if (text && text !== "Nothing notable.") {
          bucketSummaries.push(`### Source: ${bucket}\n\n${text}`);
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        console.warn("haiku map failed for bucket", bucket, err);
        haikuFailed = true;
      }
    }

    // ---- Fact extraction (additive — failures never break the pipeline) ----
    for (const [bucket, arr] of buckets) {
      try {
        const evidenceJson = buildEvidenceJson(arr, members, timeRange, opts.workflow);
        const factPrompt = `Extract 2-5 structured facts about specific people from this evidence. Return ONLY valid JSON. Format: {"facts": [{"member_name": "Name", "fact_type": "shipped|reviewed|discussed|blocked|collaborated|led", "summary": "One-line summary", "evidence_ids": ["ev_1", "ev_2"]}]}`;
        const factResult = await provider.complete({
          model: cfg.classifier_model,
          system: factPrompt,
          messages: [
            {
              role: "user",
              content: `Source bucket: ${bucket}\n\nEvidence JSON:\n\`\`\`json\n${evidenceJson}\n\`\`\``,
            },
          ],
          max_tokens: 600,
          temperature: 0.1,
        });
        totalInput += factResult.input_tokens;
        totalOutput += factResult.output_tokens;

        let parsed: { facts: Array<{ member_name: string; fact_type: string; summary: string; evidence_ids: string[] }> } | null = null;
        try {
          parsed = JSON.parse(factResult.text.trim());
        } catch {
          // Try regex extraction if direct parse fails
          const match = factResult.text.match(/\{[\s\S]*"facts"[\s\S]*\}/);
          if (match) {
            try {
              parsed = JSON.parse(match[0]);
            } catch {
              console.warn("[keepr] fact extraction: failed to parse JSON from bucket", bucket);
            }
          }
        }

        if (parsed?.facts?.length) {
          const resolvedFacts: Array<{
            member_id: number;
            fact_type: string;
            summary: string;
            evidence_ids: number[];
          }> = [];

          for (const fact of parsed.facts) {
            // Resolve member_name to member_id via case-insensitive match
            const nameLow = (fact.member_name || "").toLowerCase();
            const member = members.find(
              (m) =>
                m.display_name.toLowerCase() === nameLow ||
                (m.github_handle || "").toLowerCase() === nameLow ||
                (m.slack_user_id || "").toLowerCase() === nameLow
            );
            if (!member) continue;

            // Convert ev_N strings to integer indices
            const evidenceIds = (fact.evidence_ids || [])
              .map((e) => parseInt(String(e).replace(/^ev_/, ""), 10))
              .filter((n) => !isNaN(n));

            resolvedFacts.push({
              member_id: member.id,
              fact_type: fact.fact_type,
              summary: fact.summary,
              evidence_ids: evidenceIds,
            });
          }

          if (resolvedFacts.length > 0) {
            await insertPersonFacts(sessionId, resolvedFacts);
          }
        }
      } catch (err) {
        console.warn("[keepr] fact extraction failed for bucket", bucket, err);
      }
    }

    // Haiku fallback: if Haiku errored or returned nothing useful, pass
    // raw pruned evidence directly to Sonnet. Expensive but correct.
    let synthesisInput: string;
    if (!bucketSummaries.length || haikuFailed) {
      progress("synthesize", "Haiku fallback — sending raw evidence to Sonnet");
      synthesisInput = `NOTE: Haiku summarization unavailable, raw evidence follows.\n\n${buildEvidenceJson(
        withIds,
        members,
        timeRange,
        opts.workflow
      )}`;
      await updateSession(sessionId, {
        error_message: "haiku_fallback: raw evidence sent to synthesizer",
      });
    } else {
      synthesisInput = bucketSummaries.join("\n\n---\n\n");
    }

    // ---- Memory context ----
    progress("synthesize", "Reading memory files");
    const memoryContext = await readMemoryContext({
      memoryDir: cfg.memory_dir,
      targetSlug: target?.slug ?? null,
      workflow: opts.workflow,
    });

    // ---- Reduce (Sonnet) ----
    throwIfAborted(opts.signal);
    progress("synthesize", "Synthesizing the final output");
    const systemPrompt =
      opts.workflow === "team_pulse" ? teamPulsePrompt
      : opts.workflow === "weekly_update" ? weeklyUpdatePrompt
      : opts.workflow === "perf_evaluation" ? perfEvalPrompt
      : opts.workflow === "promo_readiness" ? promoReadyPrompt
      : onePrepPrompt;

    const targetLabel = opts.workflow === "one_on_one_prep" ? "Target engineer for 1:1"
      : opts.workflow === "perf_evaluation" ? "Target engineer"
      : opts.workflow === "promo_readiness" ? "Target engineer"
      : null;

    const userBlock = [
      `# Memory context`,
      memoryContext || "first run — no prior context",
      ``,
      `# Team`,
      members
        .map((m) => `- {tm_${m.id}} ${m.display_name}${m.github_handle ? ` (@${m.github_handle})` : ""}`)
        .join("\n"),
      target && targetLabel ? `\n# ${targetLabel}\n- {tm_${target.id}} ${target.display_name}` : "",
      ``,
      `# Time range`,
      `${timeRange.start} → ${timeRange.end}`,
      ``,
      // Include engineering rubric for perf evaluation and promo readiness
      (opts.workflow === "perf_evaluation" || opts.workflow === "promo_readiness") && cfg.engineering_rubric
        ? `# Engineering rubric\n\n${cfg.engineering_rubric}\n\n`
        : "",
      `# Per-source summaries`,
      synthesisInput,
    ]
      .filter(Boolean)
      .join("\n");

    const isLongForm = opts.workflow === "perf_evaluation" || opts.workflow === "promo_readiness";
    const synth = await provider.complete({
      model: cfg.synthesis_model,
      system: systemPrompt,
      messages: [{ role: "user", content: userBlock }],
      max_tokens: isLongForm ? 5000 : 3000,
      temperature: 0.25,
      signal: opts.signal,
    });
    totalInput += synth.input_tokens;
    totalOutput += synth.output_tokens;

    const markdown = synth.text.trim();

    // ---- Write session file + update memory ----
    progress("write", "Writing session and memory files");
    const outputPath = await writeMemory({
      memoryDir: cfg.memory_dir,
      workflow: opts.workflow,
      targetSlug: target?.slug ?? null,
      targetDisplayName: target?.display_name ?? null,
      members,
      markdown,
      evidence: withIds.map(({ idNum, item, actor }) => ({
        id: `ev_${idNum}`,
        source: item.source,
        url: item.source_url,
        actor_display: actor?.display_name ?? null,
        timestamp: item.timestamp_at,
        content: item.content,
      })),
      timeRange,
    });

    // Rough cost model — Anthropic pricing as of early 2026 ballpark.
    // (Not shown to user as authoritative; just a rough spend meter.)
    const costUsd =
      (totalInput / 1_000_000) * 3 + (totalOutput / 1_000_000) * 15;

    await updateSession(sessionId, {
      output_file_path: outputPath,
      token_usage: JSON.stringify({
        input: totalInput,
        output: totalOutput,
        cost_usd: Number(costUsd.toFixed(4)),
      }),
    });
    await setSessionStatus(sessionId, "complete");

    const successOutcome: PulseOutcome = {
      kind: "ready",
      sessionId,
      outputPath,
      markdown,
      costUsd,
      sources: aggregated,
      windowDays: opts.daysBack,
    };
    logInfo(
      `pulse outcome: ready — ${summarizeSources(successOutcome.sources)}`
    ).catch(() => {});
    return successOutcome;
  } catch (err: any) {
    // User cancelled the run. Delete the session row (and cascade its
    // evidence) so a misclick doesn't clutter the sidebar. Re-throw the
    // AbortError so App.tsx can clear runState without showing a toast.
    if (isAbortError(err)) {
      try {
        await deleteSession(sessionId);
      } catch (delErr) {
        console.warn("pipeline: failed to delete cancelled session row", delErr);
      }
      throw err;
    }
    console.error("pipeline failed", err);
    await setSessionStatus(sessionId, "failed", err?.message || String(err));
    throw err;
  }
}

function mentionedTarget(it: NormalizedItem, target: TeamMember): boolean {
  if (!target.slack_user_id) return false;
  return it.content.includes(`<@${target.slack_user_id}>`);
}

function mentionedAny(it: NormalizedItem, members: TeamMember[]): boolean {
  for (const m of members) {
    if (m.slack_user_id && it.content.includes(`<@${m.slack_user_id}>`)) return true;
  }
  return false;
}
