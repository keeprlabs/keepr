// GitHub — OAuth 2.0 Device Authorization Flow + PR/review fetch.
//
// The Client ID below is a *public* identifier for Keepr's GitHub OAuth app.
// There is NO client secret in the binary — that is precisely why device flow
// is the right pattern for a distributed desktop app.
//
// Error message format is semi-public API: src/services/sourceDiagnostic.ts
// greps the strings thrown from this module (e.g. "GitHub /user: 401 Bad
// credentials") to classify failures. If you change a throw format, update
// the GITHUB_MATCHERS regexes there.

import { fetch } from "@tauri-apps/plugin-http";
import { SECRET_KEYS, getSecret, setSecret } from "./secrets";
import { getFetchCursor, setFetchCursor } from "./db";
import { throwIfAborted, isAbortError } from "../lib/abort";

// TODO: register a real GitHub OAuth app and paste its Client ID here.
// Until then users can paste a Personal Access Token in Settings as a fallback.
export const GITHUB_CLIENT_ID =
  (import.meta as any).env?.VITE_GITHUB_CLIENT_ID || "Iv1.keepr-placeholder";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

// Scopes requested at auth time. `read:org` is required so the
// authenticated user can list members of orgs they belong to (used for
// teammate mapping). Without it, GitHub only returns members who have
// publicly listed their org membership — typically a small fraction of
// any private corporate org.
export const GITHUB_OAUTH_SCOPES = "read:user repo read:org";

export async function startDeviceFlow(): Promise<DeviceCodeResponse> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: GITHUB_OAUTH_SCOPES }),
  });
  if (!res.ok) throw new Error(`GitHub device flow start failed: ${res.status}`);
  return (await res.json()) as DeviceCodeResponse;
}

export async function pollDeviceFlow(
  device_code: string,
  interval: number
): Promise<string> {
  // Poll until we get a token, an error, or the caller aborts.
  const deadline = Date.now() + 15 * 60 * 1000;
  let wait = Math.max(interval, 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      }
    );
    const data: any = await res.json();
    if (data.access_token) {
      await setSecret(SECRET_KEYS.github, data.access_token);
      return data.access_token;
    }
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      wait += 5000;
      continue;
    }
    throw new Error(data.error_description || data.error || "unknown");
  }
  throw new Error("Device flow timed out");
}

/** Allow Personal Access Token as a fallback during onboarding. */
export async function savePAT(token: string): Promise<void> {
  await setSecret(SECRET_KEYS.github, token);
}

async function gh<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Keepr/0.1",
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(`GitHub ${path}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function getViewer(): Promise<{ login: string; name: string | null }> {
  const token = await getSecret(SECRET_KEYS.github);
  if (!token) throw new Error("No GitHub token");
  return gh<{ login: string; name: string | null }>("/user", token);
}

// ---- Orgs + members (for teammate mapping) ------------------------------

export interface GitHubOrg {
  login: string;
  description: string | null;
}

export async function listUserOrgs(): Promise<GitHubOrg[]> {
  const token = await getSecret(SECRET_KEYS.github);
  if (!token) throw new Error("No GitHub token");
  const data = await gh<Array<{ login: string; description: string | null }>>(
    "/user/orgs?per_page=100",
    token
  );
  return data.map((o) => ({ login: o.login, description: o.description }));
}

export interface GitHubMember {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

const GRAPHQL_URL = "https://api.github.com/graphql";

async function ghGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const token = await getSecret(SECRET_KEYS.github);
  if (!token) throw new Error("No GitHub token");
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Keepr/0.1",
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `GitHub GraphQL: ${res.status} ${res.statusText}` +
        (errText ? ` — ${errText.slice(0, 400)}` : "")
    );
  }
  const data: any = await res.json();
  if (data.errors?.length) {
    const msgs = data.errors.map((e: any) => e.message).join("; ");
    // SAML SSO requirement and missing scopes both surface here. Surface
    // distinctly so the UI can prompt re-auth instead of generic "failed".
    if (/scope|read:org|membersWithRole/i.test(msgs)) {
      throw new Error(`GitHub GraphQL: missing read:org scope — ${msgs}`);
    }
    throw new Error(`GitHub GraphQL: ${msgs}`);
  }
  return data.data as T;
}

const ORG_MEMBERS_CAP = 2000;

/**
 * Lists members of an org via GraphQL `membersWithRole`. Returns login,
 * name, and avatar — names are why we don't use REST `/orgs/{org}/members`
 * (that endpoint does not include name). Paginates fully via cursor with a
 * 2000-member safety cap.
 */
interface OrgMembersResp {
  organization: {
    membersWithRole: {
      nodes: Array<{ login: string; name: string | null; avatarUrl: string | null }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    } | null;
  } | null;
}

export async function listOrgMembers(
  orgLogin: string,
  signal?: AbortSignal
): Promise<GitHubMember[]> {
  const out: GitHubMember[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 25; page++) {
    if (out.length >= ORG_MEMBERS_CAP) break;
    const data: OrgMembersResp = await ghGraphQL<OrgMembersResp>(
      `query($org: String!, $after: String) {
        organization(login: $org) {
          membersWithRole(first: 100, after: $after) {
            nodes { login name avatarUrl }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { org: orgLogin, after: cursor },
      signal
    );
    const block = data.organization?.membersWithRole;
    if (!block) break;
    for (const n of block.nodes) {
      out.push({
        login: n.login,
        name: n.name,
        avatarUrl: n.avatarUrl,
      });
      if (out.length >= ORG_MEMBERS_CAP) break;
    }
    if (!block.pageInfo.hasNextPage) break;
    cursor = block.pageInfo.endCursor;
    if (!cursor) break;
  }
  return out;
}

// ---- OAuth scope detection ----------------------------------------------

let _scopeCache: { token: string; scopes: string[] } | null = null;

/**
 * Reads the granted OAuth scopes by inspecting the `X-OAuth-Scopes`
 * response header from a cheap `/user` call. Cached per-token in module
 * memory. Returns [] when the call fails or the header is absent (some
 * fine-grained PATs don't surface scopes — caller should treat empty as
 * "unknown" rather than "no scopes").
 */
export async function getGrantedScopes(): Promise<string[]> {
  const token = await getSecret(SECRET_KEYS.github);
  if (!token) return [];
  if (_scopeCache && _scopeCache.token === token) return _scopeCache.scopes;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Keepr/0.1",
      },
    });
    if (!res.ok) return [];
    const raw = res.headers.get("X-OAuth-Scopes") || "";
    const scopes = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    _scopeCache = { token, scopes };
    return scopes;
  } catch {
    return [];
  }
}

/** Invalidate the scope cache (call after a successful re-auth). */
export function invalidateScopeCache(): void {
  _scopeCache = null;
}

export async function hasReadOrgScope(): Promise<boolean> {
  const scopes = await getGrantedScopes();
  // `admin:org` and `write:org` imply `read:org`.
  return scopes.some((s) => s === "read:org" || s === "write:org" || s === "admin:org");
}

export async function listOrgRepos(org: string): Promise<Array<{ name: string; full_name: string }>> {
  const token = await getSecret(SECRET_KEYS.github);
  if (!token) throw new Error("No GitHub token");
  return gh<Array<{ name: string; full_name: string }>>(
    `/orgs/${org}/repos?per_page=100&sort=pushed`,
    token
  );
}

export async function listUserRepos(): Promise<Array<{ name: string; full_name: string; owner: { login: string } }>> {
  const token = await getSecret(SECRET_KEYS.github);
  if (!token) throw new Error("No GitHub token");
  return gh(`/user/repos?per_page=100&sort=pushed`, token);
}

// ---- Fetch for pipeline --------------------------------------------------

export interface FetchedPR {
  source_id: string;
  url: string;
  title: string;
  body: string | null;
  user: string;
  state: string;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  reviews: Array<{
    source_id: string;
    url: string;
    user: string;
    state: string;
    body: string | null;
    submitted_at: string;
  }>;
}

export async function fetchRepoActivity(
  owner: string,
  repo: string,
  sinceIso: string,
  opts: { forceRefresh?: boolean; signal?: AbortSignal } = {}
): Promise<FetchedPR[]> {
  const token = await getSecret(SECRET_KEYS.github);
  if (!token) throw new Error("No GitHub token");

  const cacheKey = `${owner}/${repo}`;
  const cursor = opts.forceRefresh ? null : await getFetchCursor("github", cacheKey);
  const effectiveSince = cursor && cursor > sinceIso ? cursor : sinceIso;

  const prs = await gh<any[]>(
    `/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
    token,
    opts.signal
  );

  const out: FetchedPR[] = [];
  for (const pr of prs) {
    if (pr.updated_at < effectiveSince) break; // sorted desc
    if (out.length >= 200) break; // hard cap from the doc

    // Cancel check between PRs — fetching reviews per PR is the longest
    // sub-step in github fetching, so this is the right granularity.
    throwIfAborted(opts.signal);

    const reviews = await gh<any[]>(
      `/repos/${owner}/${repo}/pulls/${pr.number}/reviews?per_page=100`,
      token,
      opts.signal
    ).catch((err) => {
      // Re-throw cancellation so it bubbles out of the loop; swallow
      // everything else (reviews are best-effort — if the API errors for
      // a specific PR, we still want the PR itself in the pulse).
      if (isAbortError(err)) throw err;
      return [];
    });

    out.push({
      source_id: `${owner}/${repo}#${pr.number}`,
      url: pr.html_url,
      title: pr.title,
      body: pr.body,
      user: pr.user?.login ?? "",
      state: pr.state,
      merged_at: pr.merged_at,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      reviews: reviews.map((r: any) => ({
        source_id: `${owner}/${repo}#${pr.number}:review/${r.id}`,
        url: r.html_url,
        user: r.user?.login ?? "",
        state: r.state,
        body: r.body,
        submitted_at: r.submitted_at,
      })),
    });
  }

  await setFetchCursor("github", cacheKey, new Date().toISOString());
  return out;
}
