// Very small fuzzy matcher for the team-members step: given a github
// handle or a free-text display name, score candidate Slack users and
// return them ranked best-first. Intentionally tiny — no trigram index,
// no Levenshtein — just the heuristics that actually matter when your
// input is a github handle and your candidates are Slack display names.

import type { SlackUser } from "../../services/slack";

export interface Scored {
  user: SlackUser;
  score: number;
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

function candidateStrings(u: SlackUser): string[] {
  return [
    u.profile?.display_name || "",
    u.profile?.real_name || "",
    u.real_name || "",
    u.name || "",
  ]
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Score `query` (a display name or a handle) against a Slack user. */
function scoreOne(query: string, user: SlackUser): number {
  if (!query) return 0;
  const qn = norm(query);
  if (!qn) return 0;
  let best = 0;
  for (const cand of candidateStrings(user)) {
    const cn = norm(cand);
    if (!cn) continue;

    // Exact match on any variant — best possible.
    if (cn === qn) return 100;
    // Handle-style: qn is a substring of the candidate (e.g. "priyar"
    // matching "priya raman").
    if (cn.includes(qn)) best = Math.max(best, 75);
    if (qn.includes(cn)) best = Math.max(best, 60);

    // Token overlap — catches "priya raman" vs "Priya R." etc.
    const qTokens = tokenize(query);
    const cTokens = tokenize(cand);
    if (qTokens.length && cTokens.length) {
      const overlap = qTokens.filter((t) => cTokens.some((c) => c.startsWith(t))).length;
      if (overlap) {
        best = Math.max(best, 40 + overlap * 10);
      }
    }

    // First-letter initial match (e.g. "pr" matches "Priya Raman" via
    // initials).
    if (qn.length >= 2 && qn.length <= 4) {
      const initials = cTokens.map((t) => t[0]).join("");
      if (initials.startsWith(qn)) best = Math.max(best, 30);
    }
  }
  return best;
}

/**
 * Rank a Slack user list against a query, returning the top N above a
 * minimum score. Used to suggest a Slack user from a github handle or a
 * display name while typing.
 */
export function fuzzyMatchSlack(
  query: string,
  users: SlackUser[],
  limit = 5
): Scored[] {
  const out: Scored[] = [];
  for (const u of users) {
    const s = scoreOne(query, u);
    if (s > 0) out.push({ user: u, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export function bestSlackMatch(
  query: string,
  users: SlackUser[]
): SlackUser | null {
  const ranked = fuzzyMatchSlack(query, users, 1);
  if (!ranked.length) return null;
  if (ranked[0].score < 40) return null;
  return ranked[0].user;
}

export function slackDisplay(u: SlackUser): string {
  return u.profile?.display_name || u.real_name || u.name || u.id;
}
