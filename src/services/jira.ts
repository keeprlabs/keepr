// Jira Cloud — BYO API token model. User provides their Atlassian email +
// API token (generated at id.atlassian.com/manage-profile/security/api-tokens).
// We use Basic auth with email:token, same as Jira's official docs recommend.
//
// Error message format is semi-public API: src/services/sourceDiagnostic.ts
// greps the strings thrown from this module (e.g. "Jira /search: 410 Gone")
// to classify failures. If you change a throw format, update the
// JIRA_MATCHERS regexes there.

import { fetch } from "@tauri-apps/plugin-http";
import { SECRET_KEYS, getSecret } from "./secrets";
import { getConfig } from "./db";
import { getFetchCursor, setFetchCursor } from "./db";

async function jiraHeaders(): Promise<Record<string, string>> {
  const email = await getSecret(SECRET_KEYS.jiraEmail);
  const token = await getSecret(SECRET_KEYS.jiraToken);
  if (!email || !token) throw new Error("No Jira credentials configured");
  const encoded = btoa(`${email}:${token}`);
  return {
    Authorization: `Basic ${encoded}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function jiraBaseUrl(): Promise<string> {
  const cfg = await getConfig();
  if (!cfg.jira_cloud_url) throw new Error("No Jira Cloud URL configured");
  // Normalize: strip trailing slash
  return cfg.jira_cloud_url.replace(/\/+$/, "");
}

async function jira<T>(path: string, signal?: AbortSignal): Promise<T> {
  const base = await jiraBaseUrl();
  const headers = await jiraHeaders();
  const res = await fetch(`${base}${path}`, { headers, signal });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Jira ${path}: ${res.status} ${res.statusText}` +
        (errText ? ` — ${errText.slice(0, 300)}` : "")
    );
  }
  return (await res.json()) as T;
}

async function jiraPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const base = await jiraBaseUrl();
  const headers = await jiraHeaders();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `Jira ${path}: ${res.status} ${res.statusText}` +
        (errText ? ` — ${errText.slice(0, 300)}` : "")
    );
  }
  return (await res.json()) as T;
}

// ---- Auth test ------------------------------------------------------------

export async function testConnection(): Promise<{ displayName: string }> {
  const data = await jira<{ displayName: string }>("/rest/api/3/myself");
  return { displayName: data.displayName };
}

// ---- Projects -------------------------------------------------------------

export interface JiraProjectRemote {
  id: string;
  key: string;
  name: string;
}

export async function listProjects(): Promise<JiraProjectRemote[]> {
  const data = await jira<{ values: JiraProjectRemote[] }>(
    "/rest/api/3/project/search?maxResults=50&orderBy=name"
  );
  return data.values || [];
}

// ---- Users (for team member picker) ----------------------------------------

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export async function listProjectMembers(projectKey: string): Promise<JiraUser[]> {
  // Jira Cloud: get users assignable to a project — this gives us the
  // people who are actually part of the project, not the entire org.
  try {
    const data = await jira<JiraUser[]>(
      `/rest/api/3/user/assignable/search?project=${encodeURIComponent(projectKey)}&maxResults=100`
    );
    return (data || []).filter((u) => u.displayName);
  } catch {
    // Fallback: search for all users (some Jira instances restrict assignable/search)
    const data = await jira<JiraUser[]>(
      `/rest/api/3/users/search?maxResults=100`
    );
    return (data || []).filter((u) => u.displayName);
  }
}

// ---- Fetch for pipeline ---------------------------------------------------

export interface FetchedJiraIssue {
  source_id: string;
  url: string;
  key: string;
  summary: string;
  description: string;
  status: string;
  assignee: string | null;
  reporter: string | null;
  created: string;
  updated: string;
  comments: FetchedJiraComment[];
}

export interface FetchedJiraComment {
  source_id: string;
  url: string;
  author: string | null;
  body: string;
  created: string;
}

export async function fetchProjectActivity(
  projectKey: string,
  sinceIso: string,
  opts: { forceRefresh?: boolean; signal?: AbortSignal } = {}
): Promise<FetchedJiraIssue[]> {
  const email = await getSecret(SECRET_KEYS.jiraEmail);
  const token = await getSecret(SECRET_KEYS.jiraToken);
  if (!email || !token) throw new Error("No Jira credentials");

  const cacheKey = `project:${projectKey}`;
  const cursor = opts.forceRefresh ? null : await getFetchCursor("jira", cacheKey);
  const effectiveSince = cursor && cursor > sinceIso ? cursor : sinceIso;

  // Legacy /rest/api/3/search was removed by Atlassian in May 2025 (returns
  // 410 Gone). We now use the enhanced /rest/api/3/search/jql endpoint: POST
  // with JSON body, cursor-based pagination via nextPageToken. The enhanced
  // endpoint does NOT return the `comment` field — comments must be fetched
  // per issue via /rest/api/3/issue/{key}/comment.
  // https://developer.atlassian.com/cloud/jira/platform/changelog/
  const sinceDate = effectiveSince.split("T")[0];
  const jql = `project = "${projectKey}" AND updated >= "${sinceDate}" ORDER BY updated DESC`;

  const data = await jiraPost<{
    issues: Array<{
      id: string;
      key: string;
      self: string;
      fields: {
        summary: string;
        description: any;
        status: { name: string };
        assignee: { displayName: string; accountId: string } | null;
        reporter: { displayName: string; accountId: string } | null;
        created: string;
        updated: string;
      };
    }>;
    nextPageToken?: string;
    isLast?: boolean;
  }>(
    "/rest/api/3/search/jql",
    {
      jql,
      fields: ["summary", "description", "status", "assignee", "reporter", "created", "updated"],
      maxResults: 100,
    },
    opts.signal
  );

  const base = await jiraBaseUrl();
  const out: FetchedJiraIssue[] = [];

  for (const issue of data.issues || []) {
    if (out.length >= 200) break;

    const descText = extractJiraText(issue.fields.description);
    const issueUrl = `${base}/browse/${issue.key}`;

    // Comments: separate call per issue (new endpoint doesn't inline them).
    // Best-effort — if it fails, we keep the issue without comments.
    const comments: FetchedJiraComment[] = [];
    try {
      const commentData = await jira<{
        comments: Array<{
          id: string;
          author: { displayName: string; accountId: string };
          body: any;
          created: string;
        }>;
      }>(`/rest/api/3/issue/${issue.key}/comment?maxResults=50`, opts.signal);

      for (const c of commentData.comments || []) {
        const bodyText = extractJiraText(c.body);
        if (!bodyText.trim()) continue;
        comments.push({
          source_id: `${issue.key}:comment/${c.id}`,
          url: `${issueUrl}?focusedId=${c.id}`,
          author: c.author?.displayName ?? null,
          body: bodyText.slice(0, 800),
          created: c.created,
        });
      }
    } catch {
      // swallow — comments are auxiliary, shouldn't fail the whole fetch
    }

    out.push({
      source_id: issue.key,
      url: issueUrl,
      key: issue.key,
      summary: issue.fields.summary,
      description: descText.slice(0, 1200),
      status: issue.fields.status?.name ?? "Unknown",
      assignee: issue.fields.assignee?.displayName ?? null,
      reporter: issue.fields.reporter?.displayName ?? null,
      created: issue.fields.created,
      updated: issue.fields.updated,
      comments,
    });
  }

  await setFetchCursor("jira", cacheKey, new Date().toISOString());
  return out;
}

// Jira Cloud API v3 returns Atlassian Document Format (ADF) JSON for
// description and comment bodies. We extract plain text recursively.
function extractJiraText(adf: any): string {
  if (!adf) return "";
  if (typeof adf === "string") return adf;
  if (adf.type === "text") return adf.text || "";
  if (Array.isArray(adf.content)) {
    return adf.content.map(extractJiraText).join(" ");
  }
  return "";
}
