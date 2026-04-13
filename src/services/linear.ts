// Linear — BYO personal API key model. User generates a key at
// linear.app/settings/api. We use the GraphQL API which is clean and
// well-documented.

import { fetch } from "@tauri-apps/plugin-http";
import { SECRET_KEYS, getSecret } from "./secrets";
import { getFetchCursor, setFetchCursor } from "./db";

const LINEAR_API = "https://api.linear.app/graphql";

async function linearFetch<T>(query: string, variables: Record<string, any> = {}): Promise<T> {
  const key = await getSecret(SECRET_KEYS.linear);
  if (!key) throw new Error("No Linear API key configured");

  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API: ${res.status} ${res.statusText}`);
  }

  const data: any = await res.json();
  if (data.errors?.length) {
    throw new Error(`Linear API: ${data.errors[0].message}`);
  }
  return data.data as T;
}

// ---- Auth test ------------------------------------------------------------

export async function testConnection(): Promise<{ name: string; email: string }> {
  const data = await linearFetch<{ viewer: { name: string; email: string } }>(`
    query { viewer { name email } }
  `);
  return data.viewer;
}

// ---- Teams ----------------------------------------------------------------

export interface LinearTeamRemote {
  id: string;
  key: string;
  name: string;
}

export async function listTeams(): Promise<LinearTeamRemote[]> {
  const data = await linearFetch<{ teams: { nodes: LinearTeamRemote[] } }>(`
    query { teams { nodes { id key name } } }
  `);
  return data.teams.nodes;
}

// ---- Fetch for pipeline ---------------------------------------------------

export interface FetchedLinearIssue {
  source_id: string;
  url: string;
  identifier: string;
  title: string;
  description: string;
  state: string;
  assignee: string | null;
  creator: string | null;
  createdAt: string;
  updatedAt: string;
  comments: FetchedLinearComment[];
}

export interface FetchedLinearComment {
  source_id: string;
  url: string;
  author: string | null;
  body: string;
  createdAt: string;
}

export async function fetchTeamActivity(
  teamId: string,
  teamKey: string,
  sinceIso: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<FetchedLinearIssue[]> {
  const key = await getSecret(SECRET_KEYS.linear);
  if (!key) throw new Error("No Linear API key");

  const cacheKey = `team:${teamId}`;
  const cursor = opts.forceRefresh ? null : await getFetchCursor("linear", cacheKey);
  const effectiveSince = cursor && cursor > sinceIso ? cursor : sinceIso;

  const data = await linearFetch<{
    issues: {
      nodes: Array<{
        id: string;
        identifier: string;
        url: string;
        title: string;
        description: string | null;
        state: { name: string };
        assignee: { name: string; displayName: string } | null;
        creator: { name: string; displayName: string } | null;
        createdAt: string;
        updatedAt: string;
        comments: {
          nodes: Array<{
            id: string;
            url: string;
            user: { name: string; displayName: string } | null;
            body: string;
            createdAt: string;
          }>;
        };
      }>;
    };
  }>(
    `query($teamId: String!, $since: DateTime!) {
      issues(
        filter: {
          team: { id: { eq: $teamId } }
          updatedAt: { gte: $since }
        }
        first: 100
        orderBy: updatedAt
      ) {
        nodes {
          id identifier url title description
          state { name }
          assignee { name displayName }
          creator { name displayName }
          createdAt updatedAt
          comments(first: 20) {
            nodes {
              id url body createdAt
              user { name displayName }
            }
          }
        }
      }
    }`,
    { teamId, since: effectiveSince }
  );

  const out: FetchedLinearIssue[] = [];

  for (const issue of data.issues.nodes) {
    if (out.length >= 200) break;

    const comments: FetchedLinearComment[] = [];
    for (const c of issue.comments.nodes) {
      if (!c.body?.trim()) continue;
      comments.push({
        source_id: `${issue.identifier}:comment/${c.id}`,
        url: c.url,
        author: c.user?.displayName ?? c.user?.name ?? null,
        body: c.body.slice(0, 800),
        createdAt: c.createdAt,
      });
    }

    out.push({
      source_id: issue.identifier,
      url: issue.url,
      identifier: issue.identifier,
      title: issue.title,
      description: (issue.description || "").slice(0, 1200),
      state: issue.state?.name ?? "Unknown",
      assignee: issue.assignee?.displayName ?? issue.assignee?.name ?? null,
      creator: issue.creator?.displayName ?? issue.creator?.name ?? null,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      comments,
    });
  }

  await setFetchCursor("linear", cacheKey, new Date().toISOString());
  return out;
}
