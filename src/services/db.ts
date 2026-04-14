// Thin SQLite wrapper built on tauri-plugin-sql.
// All schema migrations live in src-tauri/src/lib.rs.

import Database from "@tauri-apps/plugin-sql";
import type {
  AppConfig,
  EvidenceItem,
  Integration,
  PersonFact,
  Provider,
  QueryHistoryItem,
  SessionRow,
  SessionStatus,
  TeamMember,
  WorkflowType,
} from "../lib/types";
import { DEFAULT_CONFIG } from "../lib/types";

let _db: Database | null = null;

export async function db(): Promise<Database> {
  if (!_db) {
    _db = await Database.load("sqlite:keepr.db");
  }
  return _db;
}

// ---- Config --------------------------------------------------------------

export async function getConfig(): Promise<AppConfig> {
  const d = await db();
  const rows = await d.select<Array<{ key: string; value: string }>>(
    "SELECT key, value FROM app_config"
  );
  const cfg: AppConfig = { ...DEFAULT_CONFIG };
  for (const row of rows) {
    try {
      (cfg as any)[row.key] = JSON.parse(row.value);
    } catch {
      (cfg as any)[row.key] = row.value;
    }
  }
  return cfg;
}

export async function setConfig(partial: Partial<AppConfig>): Promise<void> {
  const d = await db();
  for (const [key, value] of Object.entries(partial)) {
    await d.execute(
      "INSERT INTO app_config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, JSON.stringify(value)]
    );
  }
}

// ---- Integrations --------------------------------------------------------

export async function upsertIntegration(
  provider: Provider,
  metadata: Record<string, unknown>,
  status: "active" | "reauth_required" = "active"
): Promise<void> {
  const d = await db();
  const existing = await d.select<Integration[]>(
    "SELECT * FROM integrations WHERE provider = ?",
    [provider]
  );
  if (existing.length) {
    await d.execute(
      "UPDATE integrations SET metadata = ?, status = ? WHERE provider = ?",
      [JSON.stringify(metadata), status, provider]
    );
  } else {
    await d.execute(
      "INSERT INTO integrations(provider, metadata, status) VALUES(?, ?, ?)",
      [provider, JSON.stringify(metadata), status]
    );
  }
}

export async function listIntegrations(): Promise<Integration[]> {
  const d = await db();
  return d.select<Integration[]>("SELECT * FROM integrations ORDER BY id");
}

// ---- Team members --------------------------------------------------------

export async function listMembers(): Promise<TeamMember[]> {
  const d = await db();
  return d.select<TeamMember[]>(
    "SELECT * FROM team_members ORDER BY display_name COLLATE NOCASE"
  );
}

export async function upsertMember(m: {
  display_name: string;
  github_handle?: string | null;
  slack_user_id?: string | null;
  jira_username?: string | null;
  linear_username?: string | null;
  slug: string;
  id?: number;
}): Promise<number> {
  const d = await db();
  if (m.id) {
    await d.execute(
      "UPDATE team_members SET display_name=?, github_handle=?, slack_user_id=?, jira_username=?, linear_username=?, slug=? WHERE id=?",
      [m.display_name, m.github_handle ?? null, m.slack_user_id ?? null, m.jira_username ?? null, m.linear_username ?? null, m.slug, m.id]
    );
    return m.id;
  }
  const res = await d.execute(
    "INSERT INTO team_members(display_name, github_handle, slack_user_id, jira_username, linear_username, slug) VALUES(?,?,?,?,?,?)",
    [m.display_name, m.github_handle ?? null, m.slack_user_id ?? null, m.jira_username ?? null, m.linear_username ?? null, m.slug]
  );
  return res.lastInsertId as number;
}

export async function deleteMember(id: number): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM team_members WHERE id = ?", [id]);
}

// ---- Sessions ------------------------------------------------------------

export async function createSession(params: {
  workflow_type: WorkflowType;
  target_member_id: number | null;
  time_range_start: string;
  time_range_end: string;
}): Promise<number> {
  const d = await db();
  const res = await d.execute(
    "INSERT INTO sessions(workflow_type, target_member_id, time_range_start, time_range_end, status) VALUES(?,?,?,?, 'pending')",
    [
      params.workflow_type,
      params.target_member_id,
      params.time_range_start,
      params.time_range_end,
    ]
  );
  return res.lastInsertId as number;
}

export async function updateSession(
  id: number,
  patch: Partial<
    Pick<
      SessionRow,
      | "status"
      | "error_message"
      | "output_file_path"
      | "token_usage"
      | "completed_at"
    >
  >
): Promise<void> {
  const d = await db();
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (!keys.length) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  const vals = keys.map((k) => (patch as any)[k]);
  await d.execute(`UPDATE sessions SET ${set} WHERE id = ?`, [...vals, id]);
}

export async function listSessions(
  limit = 50,
  includeArchived = false
): Promise<SessionRow[]> {
  const d = await db();
  const where = includeArchived ? "" : "WHERE archived_at IS NULL";
  return d.select<SessionRow[]>(
    `SELECT * FROM sessions ${where} ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

export async function archiveSession(id: number): Promise<void> {
  const d = await db();
  await d.execute(
    "UPDATE sessions SET archived_at = CURRENT_TIMESTAMP WHERE id = ?",
    [id]
  );
}

export async function unarchiveSession(id: number): Promise<void> {
  const d = await db();
  await d.execute("UPDATE sessions SET archived_at = NULL WHERE id = ?", [id]);
}

export async function countArchivedSessions(): Promise<number> {
  const d = await db();
  const rows = await d.select<Array<{ cnt: number }>>(
    "SELECT COUNT(*) as cnt FROM sessions WHERE archived_at IS NOT NULL"
  );
  return rows[0]?.cnt ?? 0;
}

export async function getSession(id: number): Promise<SessionRow | null> {
  const d = await db();
  const rows = await d.select<SessionRow[]>(
    "SELECT * FROM sessions WHERE id = ?",
    [id]
  );
  return rows[0] ?? null;
}

export async function setSessionStatus(
  id: number,
  status: SessionStatus,
  error?: string
): Promise<void> {
  await updateSession(id, {
    status,
    error_message: error ?? null,
    completed_at:
      status === "complete" || status === "failed"
        ? new Date().toISOString()
        : null,
  });
}

// Used by the pipeline's AbortError path (user cancelled a run) and by
// SessionReader's "Delete" action on a failed session. Evidence rows
// cascade via ON DELETE CASCADE (src-tauri/src/lib.rs:48) so there is no
// orphan cleanup to do here.
export async function deleteSession(id: number): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM sessions WHERE id = ?", [id]);
}

// ---- Evidence ------------------------------------------------------------

export async function insertEvidence(
  session_id: number,
  items: Omit<EvidenceItem, "id" | "session_id">[]
): Promise<EvidenceItem[]> {
  const d = await db();
  const out: EvidenceItem[] = [];
  for (const it of items) {
    const res = await d.execute(
      "INSERT INTO evidence_items(session_id, source, source_url, source_id, actor_member_id, timestamp_at, content) VALUES(?,?,?,?,?,?,?)",
      [
        session_id,
        it.source,
        it.source_url,
        it.source_id,
        it.actor_member_id,
        it.timestamp_at,
        it.content,
      ]
    );
    out.push({ id: res.lastInsertId as number, session_id, ...it });
  }
  return out;
}

export async function listEvidence(session_id: number): Promise<EvidenceItem[]> {
  const d = await db();
  return d.select<EvidenceItem[]>(
    "SELECT * FROM evidence_items WHERE session_id = ? ORDER BY id",
    [session_id]
  );
}

// ---- Fetch cache ---------------------------------------------------------

export async function getFetchCursor(
  source: string,
  scope: string
): Promise<string | null> {
  const d = await db();
  const rows = await d.select<Array<{ last_fetched_at: string }>>(
    "SELECT last_fetched_at FROM fetch_cache WHERE source = ? AND scope = ?",
    [source, scope]
  );
  return rows[0]?.last_fetched_at ?? null;
}

export async function setFetchCursor(
  source: string,
  scope: string,
  when: string
): Promise<void> {
  const d = await db();
  await d.execute(
    `INSERT INTO fetch_cache(source, scope, last_fetched_at) VALUES(?,?,?)
     ON CONFLICT(source, scope) DO UPDATE SET last_fetched_at = excluded.last_fetched_at`,
    [source, scope, when]
  );
}

// ---- Person facts --------------------------------------------------------

export async function insertPersonFacts(
  sessionId: number,
  facts: Array<{
    member_id: number;
    fact_type: string;
    summary: string;
    evidence_ids: number[];
  }>
): Promise<void> {
  const d = await db();
  for (const f of facts) {
    // Application-level dedup: skip if same member_id + fact_type + session_id + first evidence
    const firstEv = f.evidence_ids.length > 0 ? f.evidence_ids[0] : -1;
    const existing = await d.select<Array<{ id: number }>>(
      "SELECT id FROM person_facts WHERE member_id = ? AND fact_type = ? AND session_id = ? LIMIT 1",
      [f.member_id, f.fact_type, sessionId]
    );
    if (existing.length > 0) {
      // Check first evidence match for dedup
      const row = await d.select<Array<{ evidence_ids: string }>>(
        "SELECT evidence_ids FROM person_facts WHERE id = ?",
        [existing[0].id]
      );
      if (row.length > 0) {
        try {
          const ids = JSON.parse(row[0].evidence_ids) as number[];
          if (ids.length > 0 && ids[0] === firstEv) continue;
        } catch {
          // malformed JSON — skip dedup, insert anyway
        }
      }
    }
    await d.execute(
      "INSERT INTO person_facts(member_id, session_id, fact_type, summary, evidence_ids) VALUES(?,?,?,?,?)",
      [f.member_id, sessionId, f.fact_type, f.summary, JSON.stringify(f.evidence_ids)]
    );
  }
}

export async function getPersonFacts(
  memberId: number,
  limit?: number
): Promise<PersonFact[]> {
  const d = await db();
  const sql = limit
    ? "SELECT * FROM person_facts WHERE member_id = ? ORDER BY extracted_at DESC LIMIT ?"
    : "SELECT * FROM person_facts WHERE member_id = ? ORDER BY extracted_at DESC";
  const params: unknown[] = limit ? [memberId, limit] : [memberId];
  const rows = await d.select<Array<Omit<PersonFact, "evidence_ids"> & { evidence_ids: string }>>(sql, params);
  return rows.map((r) => ({
    ...r,
    evidence_ids: JSON.parse(r.evidence_ids) as number[],
  }));
}

export async function getPersonFactCount(memberId: number): Promise<number> {
  const d = await db();
  const rows = await d.select<Array<{ cnt: number }>>(
    "SELECT COUNT(*) as cnt FROM person_facts WHERE member_id = ?",
    [memberId]
  );
  return rows[0]?.cnt ?? 0;
}

// ---- Query history -------------------------------------------------------

export async function getQueryHistory(memberId: number): Promise<QueryHistoryItem[]> {
  const d = await db();
  return d.select<QueryHistoryItem[]>(
    "SELECT * FROM query_history WHERE member_id = ? ORDER BY created_at DESC",
    [memberId]
  );
}

export async function saveQueryAnswer(
  memberId: number,
  query: string,
  answer: string
): Promise<void> {
  const d = await db();
  await d.execute(
    "INSERT INTO query_history(member_id, query, answer) VALUES(?,?,?)",
    [memberId, query, answer]
  );
}
