// Full-text search across sessions + memory files. Intentionally
// unsophisticated: the app has at most tens of sessions and a handful of
// memory files, so a linear scan with substring matching beats the
// complexity of a real index for v1.

import { listSessions, listMembers, getConfig } from "./db";
import { readFileIfExists } from "./fsio";
import type { SessionRow } from "../lib/types";

const WORKFLOW_LABELS: Record<string, string> = {
  team_pulse: "Team pulse",
  one_on_one_prep: "1:1 prep",
  weekly_update: "Weekly update",
  perf_evaluation: "Perf eval",
  promo_readiness: "Promo readiness",
};

export interface SearchHit {
  id: string;
  kind: "session" | "memory";
  title: string;
  snippet: string;
  archived?: boolean;
  // For sessions, the numeric session id so the palette can navigate.
  sessionId?: number;
  // For memory hits, the relative path within the Keepr dir.
  memoryFile?: "status" | "memory" | `people/${string}`;
}

// Build a small corpus once per palette open. Not cached across palette
// opens — sessions and memory can change between invocations.
export async function buildSearchCorpus(): Promise<
  Array<{
    id: string;
    kind: SearchHit["kind"];
    title: string;
    body: string;
    archived?: boolean;
    sessionId?: number;
    memoryFile?: SearchHit["memoryFile"];
  }>
> {
  const cfg = await getConfig();
  const sessions: SessionRow[] = await listSessions(200, true);
  const members = await listMembers();
  const memberById = new Map(members.map((m) => [m.id, m]));

  const corpus: Array<{
    id: string;
    kind: SearchHit["kind"];
    title: string;
    body: string;
    archived?: boolean;
    sessionId?: number;
    memoryFile?: SearchHit["memoryFile"];
  }> = [];

  // Sessions — pull their markdown output file if it exists.
  for (const s of sessions) {
    let body = "";
    if (s.output_file_path) {
      body = (await readFileIfExists(s.output_file_path)) || "";
    }
    const label = WORKFLOW_LABELS[s.workflow_type] || s.workflow_type;
    const memberName = s.target_member_id
      ? memberById.get(s.target_member_id)?.display_name
      : null;
    const title =
      label +
      (memberName ? ` — ${memberName}` : "") +
      " · " +
      new Date(s.created_at).toLocaleDateString();
    corpus.push({
      id: `session:${s.id}`,
      kind: "session",
      title,
      body,
      archived: !!s.archived_at,
      sessionId: s.id,
    });
  }

  // Memory files — status.md and memory.md at the top level.
  const memDir = cfg.memory_dir;
  if (memDir) {
    for (const [slug, file] of [
      ["status", "status.md"],
      ["memory", "memory.md"],
    ] as const) {
      const body = (await readFileIfExists(`${memDir}/${file}`)) || "";
      if (body) {
        corpus.push({
          id: `memory:${slug}`,
          kind: "memory",
          title: file,
          body,
          memoryFile: slug,
        });
      }
    }
    // TODO(v1.5): glob people/*.md so search can surface per-person memory.
  }

  return corpus;
}

// Find matches. Returns at most `limit` hits ranked by how early the first
// match appears and how short the title is.
export function searchCorpus(
  corpus: Awaited<ReturnType<typeof buildSearchCorpus>>,
  query: string,
  limit = 6
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: Array<SearchHit & { _score: number }> = [];
  for (const doc of corpus) {
    const hay = `${doc.title}\n${doc.body}`.toLowerCase();
    const idx = hay.indexOf(q);
    if (idx < 0) continue;
    hits.push({
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      snippet: makeSnippet(doc.body, q, 120),
      archived: doc.archived,
      sessionId: doc.sessionId,
      memoryFile: doc.memoryFile,
      _score: -idx - doc.title.length * 2,
    });
  }
  hits.sort((a, b) => b._score - a._score);
  return hits.slice(0, limit).map(({ _score, ...h }) => h);
}

function makeSnippet(body: string, q: string, width: number): string {
  const lower = body.toLowerCase();
  const i = lower.indexOf(q);
  if (i < 0) return body.slice(0, width).replace(/\s+/g, " ").trim();
  const start = Math.max(0, i - Math.floor(width / 3));
  const end = Math.min(body.length, start + width);
  let s = body.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = "… " + s;
  if (end < body.length) s = s + " …";
  return s;
}
