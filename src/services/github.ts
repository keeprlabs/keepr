// GitHub — OAuth 2.0 Device Authorization Flow + PR/review fetch.
//
// The Client ID below is a *public* identifier for Keepr's GitHub OAuth app.
// There is NO client secret in the binary — that is precisely why device flow
// is the right pattern for a distributed desktop app.

import { fetch } from "@tauri-apps/plugin-http";
import { SECRET_KEYS, getSecret, setSecret } from "./secrets";
import { getFetchCursor, setFetchCursor } from "./db";
import { throwIfAborted, isAbortError } from "../lib/abort";

// TODO(founder): register a real GitHub OAuth app and paste its Client ID here.
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

export async function startDeviceFlow(): Promise<DeviceCodeResponse> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: "read:user repo" }),
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
