// Follow-up store — markdown files with SQLite index.

import { join } from "@tauri-apps/api/path";
import { ensureDir, readFileIfExists, writeFileAtomic, listMdFiles } from "../../services/fsio";
import { db, getConfig } from "../../services/db";
import { slugify } from "../../services/memory";
import type { FollowUp } from "../../lib/types";

// ---- SQLite migration (called once on app boot) ---------------------------

export async function ensureFollowUpsTable(): Promise<void> {
  const d = await db();
  await d.execute(`
    CREATE TABLE IF NOT EXISTS followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL UNIQUE,
      subject TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','carried','resolved')),
      origin_session INTEGER,
      origin_member_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    )
  `);
}

// ---- File format ----------------------------------------------------------

function toFrontmatter(fu: Omit<FollowUp, "id">): string {
  const lines = [
    "---",
    `subject: ${fu.subject}`,
    `state: ${fu.state}`,
    `origin_session: ${fu.origin_session ?? "null"}`,
    `origin_member_id: ${fu.origin_member_id ?? "null"}`,
    `created_at: ${fu.created_at}`,
    `resolved_at: ${fu.resolved_at ?? "null"}`,
    "---",
    "",
    fu.description,
  ];
  return lines.join("\n");
}

function parseFrontmatter(content: string): {
  meta: Record<string, string>;
  body: string;
} | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val === "null" ? "" : val;
    }
  }
  return { meta, body: match[2].trim() };
}

// ---- CRUD -----------------------------------------------------------------

export async function listFollowUps(): Promise<FollowUp[]> {
  await ensureFollowUpsTable();
  const d = await db();
  return d.select<FollowUp[]>(
    "SELECT * FROM followups ORDER BY CASE state WHEN 'open' THEN 0 WHEN 'carried' THEN 1 WHEN 'resolved' THEN 2 END, created_at DESC"
  );
}

export async function listFollowUpsForMember(memberId: number): Promise<FollowUp[]> {
  await ensureFollowUpsTable();
  const d = await db();
  return d.select<FollowUp[]>(
    "SELECT * FROM followups WHERE origin_member_id = ? AND state != 'resolved' ORDER BY created_at DESC",
    [memberId]
  );
}

export async function createFollowUp(params: {
  subject: string;
  description: string;
  state?: "open" | "carried" | "resolved";
  origin_session?: number | null;
  origin_member_id?: number | null;
}): Promise<FollowUp> {
  await ensureFollowUpsTable();
  const cfg = await getConfig();
  if (!cfg.memory_dir) throw new Error("Memory directory not configured");

  const now = new Date().toISOString();
  const dateStr = now.slice(0, 10);
  const slug = slugify(params.subject);
  const fileName = `${dateStr}-${slug}.md`;
  const dir = await join(cfg.memory_dir, "followups");
  await ensureDir(dir);
  const filePath = await join(dir, fileName);

  const fu = {
    file_path: filePath,
    subject: params.subject,
    description: params.description,
    state: params.state || ("open" as const),
    origin_session: params.origin_session ?? null,
    origin_member_id: params.origin_member_id ?? null,
    created_at: now,
    resolved_at: null,
  };

  // Write file
  await writeFileAtomic(filePath, toFrontmatter(fu));

  // Insert into SQLite index
  const d = await db();
  const res = await d.execute(
    "INSERT INTO followups(file_path, subject, state, origin_session, origin_member_id, created_at) VALUES(?,?,?,?,?,?)",
    [fu.file_path, fu.subject, fu.state, fu.origin_session, fu.origin_member_id, fu.created_at]
  );

  return { id: res.lastInsertId as number, ...fu };
}

export async function updateFollowUpState(
  id: number,
  state: "open" | "carried" | "resolved"
): Promise<void> {
  await ensureFollowUpsTable();
  const d = await db();
  const resolvedAt = state === "resolved" ? new Date().toISOString() : null;

  // Update SQLite
  await d.execute(
    "UPDATE followups SET state = ?, resolved_at = ? WHERE id = ?",
    [state, resolvedAt, id]
  );

  // Update the file on disk
  const rows = await d.select<FollowUp[]>(
    "SELECT * FROM followups WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return;
  const fu = rows[0];

  const content = await readFileIfExists(fu.file_path);
  if (content) {
    const parsed = parseFrontmatter(content);
    if (parsed) {
      const updated = {
        ...fu,
        state,
        resolved_at: resolvedAt,
        description: parsed.body,
      };
      await writeFileAtomic(fu.file_path, toFrontmatter(updated));
    }
  }
}

export async function updateFollowUpSubject(
  id: number,
  subject: string,
  description: string
): Promise<void> {
  await ensureFollowUpsTable();
  const d = await db();
  await d.execute("UPDATE followups SET subject = ? WHERE id = ?", [subject, id]);

  const rows = await d.select<FollowUp[]>(
    "SELECT * FROM followups WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return;
  const fu = rows[0];

  const updated = { ...fu, subject, description };
  await writeFileAtomic(fu.file_path, toFrontmatter(updated));
}

// Auto-create follow-ups from session output
export async function autoCreateFromSession(
  sessionId: number,
  targetMemberId: number | null,
  parsed: Array<{ subject: string; description: string }>
): Promise<void> {
  for (const item of parsed) {
    await createFollowUp({
      subject: item.subject,
      description: item.description,
      origin_session: sessionId,
      origin_member_id: targetMemberId,
    });
  }
}

// Sync index from files on disk (rebuild)
export async function syncFollowUpsIndex(): Promise<void> {
  await ensureFollowUpsTable();
  const cfg = await getConfig();
  if (!cfg.memory_dir) return;

  const dir = await join(cfg.memory_dir, "followups");
  let files: string[];
  try {
    files = await listMdFiles(dir);
  } catch {
    return; // Directory doesn't exist yet
  }

  const d = await db();
  for (const file of files) {
    const filePath = await join(dir, file);
    const content = await readFileIfExists(filePath);
    if (!content) continue;

    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const existing = await d.select<Array<{ id: number }>>(
      "SELECT id FROM followups WHERE file_path = ?",
      [filePath]
    );

    if (existing.length === 0) {
      await d.execute(
        "INSERT INTO followups(file_path, subject, state, origin_session, origin_member_id, created_at, resolved_at) VALUES(?,?,?,?,?,?,?)",
        [
          filePath,
          parsed.meta.subject || file.replace(/\.md$/, ""),
          parsed.meta.state || "open",
          parsed.meta.origin_session
            ? parseInt(parsed.meta.origin_session)
            : null,
          parsed.meta.origin_member_id
            ? parseInt(parsed.meta.origin_member_id)
            : null,
          parsed.meta.created_at || new Date().toISOString(),
          parsed.meta.resolved_at || null,
        ]
      );
    }
  }
}
