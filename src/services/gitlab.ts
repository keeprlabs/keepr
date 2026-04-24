// GitLab — PAT-first today, OAuth Device Authorization flow stubbed for when
// Keepr's GitLab application is registered. Mirrors src/services/github.ts.
//
// Self-hosted instances are supported via cfg.gitlab_instance_url (defaults
// to https://gitlab.com). The PAT path works against any instance; device
// flow requires a registered application on the target instance.
//
// Error message format is semi-public API: src/services/sourceDiagnostic.ts
// greps the strings thrown from this module (e.g. "GitLab /user: 401
// Unauthorized") to classify failures. If you change a throw format, update
// the GITLAB_MATCHERS regexes there.

import { fetch } from "@tauri-apps/plugin-http";
import { SECRET_KEYS, getSecret, setSecret } from "./secrets";
import { getConfig, getFetchCursor, setFetchCursor } from "./db";
import { throwIfAborted, isAbortError } from "../lib/abort";

// Public identifier for Keepr's GitLab OAuth application. Placeholder until
// we register one on gitlab.com (self-hosted instances require a per-instance
// Application that the user registers themselves).
export const GITLAB_CLIENT_ID =
  (import.meta as any).env?.VITE_GITLAB_CLIENT_ID || "keepr-placeholder";

const DEFAULT_INSTANCE = "https://gitlab.com";

/** Strip trailing slash; fall back to gitlab.com if unset. */
function normalizeInstance(raw: string | undefined | null): string {
  const v = (raw || DEFAULT_INSTANCE).trim().replace(/\/+$/, "");
  return v || DEFAULT_INSTANCE;
}

async function instanceBase(): Promise<string> {
  const cfg = await getConfig();
  return normalizeInstance(cfg.gitlab_instance_url);
}

// ---- Device flow (gated on registered client id) -------------------------

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function startDeviceFlow(): Promise<DeviceCodeResponse> {
  const base = await instanceBase();
  const res = await fetch(`${base}/oauth/authorize_device`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: GITLAB_CLIENT_ID,
      scope: "read_api read_user read_repository",
    }),
  });
  if (!res.ok) throw new Error(`GitLab device flow start failed: ${res.status}`);
  return (await res.json()) as DeviceCodeResponse;
}

export async function pollDeviceFlow(
  device_code: string,
  interval: number
): Promise<string> {
  const base = await instanceBase();
  const deadline = Date.now() + 15 * 60 * 1000;
  let wait = Math.max(interval, 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GITLAB_CLIENT_ID,
        device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data: any = await res.json();
    if (data.access_token) {
      await setSecret(SECRET_KEYS.gitlab, data.access_token);
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
  await setSecret(SECRET_KEYS.gitlab, token);
}

// ---- REST client ---------------------------------------------------------

async function gl<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const base = await instanceBase();
  const res = await fetch(`${base}/api/v4${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "Keepr/0.1",
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(`GitLab ${path}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function getViewer(): Promise<{ username: string; name: string | null }> {
  const token = await getSecret(SECRET_KEYS.gitlab);
  if (!token) throw new Error("No GitLab token");
  return gl<{ username: string; name: string | null }>("/user", token);
}

export interface GitLabProjectRemote {
  id: number;
  name: string;
  path_with_namespace: string;
  last_activity_at?: string;
}

export async function listUserProjects(): Promise<GitLabProjectRemote[]> {
  const token = await getSecret(SECRET_KEYS.gitlab);
  if (!token) throw new Error("No GitLab token");
  // membership=true restricts to projects the user is a member of (mirrors
  // GitHub's /user/repos behavior). order_by=last_activity_at surfaces the
  // most recently touched projects first — used for smart defaults.
  return gl<GitLabProjectRemote[]>(
    `/projects?membership=true&order_by=last_activity_at&per_page=100&simple=false`,
    token
  );
}

export async function listGroupProjects(group: string): Promise<GitLabProjectRemote[]> {
  const token = await getSecret(SECRET_KEYS.gitlab);
  if (!token) throw new Error("No GitLab token");
  return gl<GitLabProjectRemote[]>(
    `/groups/${encodeURIComponent(group)}/projects?per_page=100&order_by=last_activity_at`,
    token
  );
}

// ---- Fetch for pipeline --------------------------------------------------

export interface FetchedGitLabMR {
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
    state: string; // APPROVED | COMMENTED | CHANGES_REQUESTED
    body: string | null;
    submitted_at: string;
  }>;
}

// An "approval" is not technically a review but we map it into the same
// review shape so downstream code (normalize, prune, evidence cards, graph)
// treats it like a GitHub APPROVED review.
interface MRApproval {
  user: { username: string } | null;
  created_at: string;
}

interface MRNote {
  id: number;
  body: string;
  system: boolean;
  author: { username: string } | null;
  created_at: string;
}

export async function fetchProjectActivity(
  projectId: number,
  pathWithNamespace: string,
  sinceIso: string,
  opts: { forceRefresh?: boolean; signal?: AbortSignal } = {}
): Promise<FetchedGitLabMR[]> {
  const token = await getSecret(SECRET_KEYS.gitlab);
  if (!token) throw new Error("No GitLab token");

  const cacheKey = pathWithNamespace;
  const cursor = opts.forceRefresh ? null : await getFetchCursor("gitlab", cacheKey);
  const effectiveSince = cursor && cursor > sinceIso ? cursor : sinceIso;

  const base = await instanceBase();

  // GitLab: updated_after is an ISO-8601 filter on the index endpoint, so we
  // don't need the client-side `break` loop GitHub needs. state=all gives us
  // opened/merged/closed in one pass. Order by updated_at desc to match
  // GitHub's "most recent first" fetch shape.
  const mrs = await gl<any[]>(
    `/projects/${projectId}/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=100&updated_after=${encodeURIComponent(effectiveSince)}`,
    token,
    opts.signal
  );

  const out: FetchedGitLabMR[] = [];
  for (const mr of mrs) {
    if (out.length >= 200) break;

    throwIfAborted(opts.signal);

    // Approvals: best-effort. Some instances restrict this endpoint (EE-only
    // features) or return 404 for forks. If it fails we still emit the MR
    // with notes-as-reviews only.
    const approvals = await gl<{ approved_by?: Array<{ user: { username: string } }> } | any>(
      `/projects/${projectId}/merge_requests/${mr.iid}/approvals`,
      token,
      opts.signal
    ).catch((err) => {
      if (isAbortError(err)) throw err;
      return null;
    });

    const notes = await gl<MRNote[]>(
      `/projects/${projectId}/merge_requests/${mr.iid}/notes?sort=asc&order_by=created_at&per_page=100`,
      token,
      opts.signal
    ).catch((err) => {
      if (isAbortError(err)) throw err;
      return [] as MRNote[];
    });

    const reviews: FetchedGitLabMR["reviews"] = [];

    // 1) Approvals → APPROVED reviews (body empty).
    const approvers: MRApproval[] = Array.isArray(approvals?.approved_by)
      ? (approvals.approved_by as Array<{ user: { username: string } }>).map(
          (a) => ({ user: a.user, created_at: mr.updated_at })
        )
      : [];
    for (const a of approvers) {
      if (!a.user?.username) continue;
      reviews.push({
        source_id: `${pathWithNamespace}!${mr.iid}:approval/${a.user.username}`,
        url: `${base}/${pathWithNamespace}/-/merge_requests/${mr.iid}`,
        user: a.user.username,
        state: "APPROVED",
        body: null,
        submitted_at: a.created_at,
      });
    }

    // 2) Non-system notes → COMMENTED reviews (user preference: "every note
    // as evidence"). System notes like "changed target branch" or "assigned
    // @x" are filtered.
    for (const n of notes) {
      if (n.system) continue;
      if (!n.author?.username) continue;
      if (!n.body || !n.body.trim()) continue;
      reviews.push({
        source_id: `${pathWithNamespace}!${mr.iid}:note/${n.id}`,
        url: `${base}/${pathWithNamespace}/-/merge_requests/${mr.iid}#note_${n.id}`,
        user: n.author.username,
        state: "COMMENTED",
        body: n.body,
        submitted_at: n.created_at,
      });
    }

    out.push({
      source_id: `${pathWithNamespace}!${mr.iid}`,
      url: mr.web_url,
      title: mr.title,
      body: mr.description,
      user: mr.author?.username ?? "",
      state: mr.state,
      merged_at: mr.merged_at ?? null,
      created_at: mr.created_at,
      updated_at: mr.updated_at,
      reviews,
    });
  }

  await setFetchCursor("gitlab", cacheKey, new Date().toISOString());
  return out;
}
