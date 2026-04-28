// Unified search across the four people-providers Keepr maps team members
// to (Slack, GitHub, Linear, Jira). Each adapter returns `ProviderUserMatch`
// so the combobox UI can stay provider-agnostic.
//
// The persisted `handle` field below matches what the pipeline's actor
// resolution looks up (services/pipeline.ts:359-383):
//   - slack:  Slack user id (e.g. "U01ABC")           → team_members.slack_user_id
//   - github: login (e.g. "octocat")                  → team_members.github_handle
//   - linear: displayName (or name fallback)          → team_members.linear_username
//   - jira:   displayName                             → team_members.jira_username
//
// Linear and Jira are matched by display-name string equality (lowercased)
// in the pipeline, so the picker MUST persist the displayName the user
// picks, not the underlying id. The `id` field is kept on the match for
// dedup inside the combobox dropdown only.

import { rankCandidates } from "../components/onboarding/fuzzyMatch";
import * as github from "./github";
import * as jira from "./jira";
import * as linear from "./linear";
import type { GitHubMember } from "./github";
import type { JiraUser } from "./jira";
import type { LinearUser } from "./linear";
import type { SlackUser } from "./slack";

export type TeammateProvider = "slack" | "github" | "linear" | "jira";

export interface ProviderUserMatch {
  provider: TeammateProvider;
  /** Stable id from the provider — used as React key + dedup in dropdowns. */
  id: string;
  /** What we persist in team_members.{slack_user_id|github_handle|...}. */
  handle: string;
  /** Primary visible label in the dropdown row. */
  label: string;
  /** Optional secondary line (email / handle / etc). */
  detail?: string;
  avatarUrl?: string;
  score?: number;
}

// ── Slack ──────────────────────────────────────────────────────────────────

function slackLabel(u: SlackUser): string {
  return u.profile?.display_name || u.real_name || u.name || u.id;
}

function slackDetail(u: SlackUser): string | undefined {
  // Show the @handle as detail when display_name is something different.
  if (u.profile?.display_name && u.name && u.profile.display_name !== u.name) {
    return `@${u.name}`;
  }
  return u.name ? `@${u.name}` : undefined;
}

function slackCandidates(u: SlackUser): string[] {
  return [
    u.profile?.display_name || "",
    u.profile?.real_name || "",
    u.real_name || "",
    u.name || "",
  ]
    .map((s) => s.trim())
    .filter(Boolean);
}

export function searchSlack(
  query: string,
  cache: SlackUser[],
  limit = 8
): ProviderUserMatch[] {
  if (!cache.length) return [];
  if (!query.trim()) {
    // Empty query: return the first `limit` users alphabetically by label.
    return cache
      .slice()
      .sort((a, b) => slackLabel(a).localeCompare(slackLabel(b)))
      .slice(0, limit)
      .map((u) => ({
        provider: "slack" as const,
        id: u.id,
        handle: u.id,
        label: slackLabel(u),
        detail: slackDetail(u),
      }));
  }
  return rankCandidates(query, cache, slackCandidates, limit).map((s) => ({
    provider: "slack" as const,
    id: s.user.id,
    handle: s.user.id,
    label: slackLabel(s.user),
    detail: slackDetail(s.user),
    score: s.score,
  }));
}

export function resolveSlackLabel(handle: string, cache: SlackUser[]): string | null {
  const u = cache.find((x) => x.id === handle);
  return u ? slackLabel(u) : null;
}

// ── Linear ─────────────────────────────────────────────────────────────────

function linearLabel(u: LinearUser): string {
  return u.displayName || u.name;
}

function linearCandidates(u: LinearUser): string[] {
  return [u.displayName, u.name, u.email || ""].filter(Boolean);
}

export function searchLinear(
  query: string,
  cache: LinearUser[],
  limit = 8
): ProviderUserMatch[] {
  if (!cache.length) return [];
  if (!query.trim()) {
    return cache
      .slice()
      .sort((a, b) => linearLabel(a).localeCompare(linearLabel(b)))
      .slice(0, limit)
      .map((u) => ({
        provider: "linear" as const,
        id: u.id,
        handle: linearLabel(u),
        label: linearLabel(u),
        detail: u.email,
      }));
  }
  return rankCandidates(query, cache, linearCandidates, limit).map((s) => ({
    provider: "linear" as const,
    id: s.user.id,
    handle: linearLabel(s.user),
    label: linearLabel(s.user),
    detail: s.user.email,
    score: s.score,
  }));
}

export function resolveLinearLabel(handle: string, cache: LinearUser[]): string | null {
  const u = cache.find((x) => linearLabel(x) === handle);
  return u ? linearLabel(u) : null;
}

// ── Jira ───────────────────────────────────────────────────────────────────

function jiraLabel(u: JiraUser): string {
  return u.displayName;
}

function jiraCandidates(u: JiraUser): string[] {
  return [u.displayName, u.emailAddress || ""].filter(Boolean);
}

/**
 * Loads and merges assignable users across all selected Jira projects.
 * Falls back to the org-wide /users/search inside `listProjectMembers` when
 * a project's assignable endpoint is restricted. Dedups by accountId.
 */
export async function loadJiraUserPool(
  projectKeys: string[]
): Promise<JiraUser[]> {
  if (!projectKeys.length) return [];
  const seen = new Map<string, JiraUser>();
  // Sequential to avoid hammering Jira; each call is already 100 max.
  for (const key of projectKeys) {
    try {
      const users = await jira.listProjectMembers(key);
      for (const u of users) {
        if (!seen.has(u.accountId)) seen.set(u.accountId, u);
      }
    } catch {
      // Per-project failure: continue with whatever we have.
    }
  }
  return Array.from(seen.values());
}

export function searchJira(
  query: string,
  cache: JiraUser[],
  limit = 8
): ProviderUserMatch[] {
  if (!cache.length) return [];
  if (!query.trim()) {
    return cache
      .slice()
      .sort((a, b) => jiraLabel(a).localeCompare(jiraLabel(b)))
      .slice(0, limit)
      .map((u) => ({
        provider: "jira" as const,
        id: u.accountId,
        handle: jiraLabel(u),
        label: jiraLabel(u),
        detail: u.emailAddress,
      }));
  }
  return rankCandidates(query, cache, jiraCandidates, limit).map((s) => ({
    provider: "jira" as const,
    id: s.user.accountId,
    handle: jiraLabel(s.user),
    label: jiraLabel(s.user),
    detail: s.user.emailAddress,
    score: s.score,
  }));
}

export function resolveJiraLabel(handle: string, cache: JiraUser[]): string | null {
  const u = cache.find((x) => x.displayName === handle);
  return u ? jiraLabel(u) : null;
}

// ── GitHub (cache-backed, scoped to user's orgs) ──────────────────────────

function githubLabel(m: GitHubMember): string {
  return m.name ? `${m.name} (@${m.login})` : `@${m.login}`;
}

function githubCandidates(m: GitHubMember): string[] {
  return [m.login, m.name || ""].filter(Boolean) as string[];
}

export function searchGitHub(
  query: string,
  cache: GitHubMember[],
  limit = 8
): ProviderUserMatch[] {
  if (!cache.length) return [];
  if (!query.trim()) {
    return cache
      .slice()
      .sort((a, b) => githubLabel(a).localeCompare(githubLabel(b)))
      .slice(0, limit)
      .map((m) => ({
        provider: "github" as const,
        id: m.login,
        handle: m.login,
        label: githubLabel(m),
        detail: undefined,
        avatarUrl: m.avatarUrl ?? undefined,
      }));
  }
  return rankCandidates(query, cache, githubCandidates, limit).map((s) => ({
    provider: "github" as const,
    id: s.user.login,
    handle: s.user.login,
    label: githubLabel(s.user),
    detail: undefined,
    avatarUrl: s.user.avatarUrl ?? undefined,
    score: s.score,
  }));
}

export function resolveGitHubLabel(
  handle: string,
  cache: GitHubMember[]
): string | null {
  const m = cache.find((x) => x.login === handle);
  return m ? githubLabel(m) : null;
}

// Module-level singleton so StepTeam and Settings share one fetch per
// session. The pool is the union of members across every org the user
// belongs to, deduped by login.
let _githubPool: GitHubMember[] | null = null;
let _githubPoolPromise: Promise<GitHubMember[]> | null = null;

export function getCachedGitHubPool(): GitHubMember[] | null {
  return _githubPool;
}

export function invalidateGitHubPool(): void {
  _githubPool = null;
  _githubPoolPromise = null;
}

/**
 * Loads members across every org the user belongs to. Coalesces concurrent
 * callers, caches the result for the rest of the session. Returns [] when
 * the user belongs to no orgs (solo developer, personal repos only).
 *
 * Per-org failures are tolerated — a single org's permission error must
 * not zero out the whole pool.
 */
export async function loadGitHubMemberPool(): Promise<GitHubMember[]> {
  if (_githubPool) return _githubPool;
  if (_githubPoolPromise) return _githubPoolPromise;
  _githubPoolPromise = (async () => {
    try {
      const orgs = await github.listUserOrgs().catch(() => [] as github.GitHubOrg[]);
      if (!orgs.length) {
        _githubPool = [];
        return _githubPool;
      }
      const seen = new Map<string, GitHubMember>();
      const results = await Promise.all(
        orgs.map((o) =>
          github
            .listOrgMembers(o.login)
            .catch(() => [] as GitHubMember[])
        )
      );
      for (const list of results) {
        for (const m of list) {
          if (!seen.has(m.login)) seen.set(m.login, m);
        }
      }
      _githubPool = Array.from(seen.values());
      return _githubPool;
    } finally {
      // Always clear the in-flight slot so a rejected promise can't poison
      // every subsequent caller for the rest of the session.
      _githubPoolPromise = null;
    }
  })();
  return _githubPoolPromise;
}
