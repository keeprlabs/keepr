// Tiny fuzzy matcher for the team-members step. Generic over candidate
// shape: callers pass a function returning the strings to match against.
// Intentionally small — no trigrams, no Levenshtein — just the heuristics
// that matter when input is a human name or handle and candidates are
// display names from a provider's user list.

import type { SlackUser } from "../../services/slack";

export interface Scored<T> {
  user: T;
  score: number;
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Score `query` against an array of candidate strings. */
export function scoreCandidates(query: string, candidates: string[]): number {
  if (!query) return 0;
  const qn = norm(query);
  if (!qn) return 0;
  const qTokens = tokenize(query);
  let best = 0;
  for (const cand of candidates) {
    if (!cand) continue;
    const cn = norm(cand);
    if (!cn) continue;

    if (cn === qn) return 100;
    if (cn.includes(qn)) best = Math.max(best, 75);
    if (qn.includes(cn)) best = Math.max(best, 60);

    const cTokens = tokenize(cand);
    if (qTokens.length && cTokens.length) {
      const overlap = qTokens.filter((t) =>
        cTokens.some((c) => c.startsWith(t))
      ).length;
      if (overlap) {
        best = Math.max(best, 40 + overlap * 10);
      }
    }

    if (qn.length >= 2 && qn.length <= 4) {
      const initials = cTokens.map((t) => t[0]).join("");
      if (initials.startsWith(qn)) best = Math.max(best, 30);
    }
  }
  return best;
}

/** Generic ranker. Returns the top `limit` candidates with score > 0. */
export function rankCandidates<T>(
  query: string,
  items: T[],
  getStrings: (item: T) => string[],
  limit = 5
): Scored<T>[] {
  const out: Scored<T>[] = [];
  for (const item of items) {
    const s = scoreCandidates(query, getStrings(item));
    if (s > 0) out.push({ user: item, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// ── Slack-specific helpers (kept for back-compat with existing tests/UI) ─

function slackCandidateStrings(u: SlackUser): string[] {
  return [
    u.profile?.display_name || "",
    u.profile?.real_name || "",
    u.real_name || "",
    u.name || "",
  ]
    .map((s) => s.trim())
    .filter(Boolean);
}

export function fuzzyMatchSlack(
  query: string,
  users: SlackUser[],
  limit = 5
): Scored<SlackUser>[] {
  return rankCandidates(query, users, slackCandidateStrings, limit);
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
