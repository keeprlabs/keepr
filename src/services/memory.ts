// Local markdown memory layer. The files on disk are the canonical truth.
// SQLite is just a pointer.
//
// Observed-facts-only discipline: we extract `## Memory deltas` bullets
// from the LLM output and ONLY those get appended to people/*.md. The full
// synthesis (with interpretations) lives in sessions/*.md.

import { join } from "@tauri-apps/api/path";
import {
  acquireLock,
  ensureDir,
  fileMeta,
  listMdFiles,
  readFileIfExists,
  releaseLock,
  writeFileAtomic,
} from "./fsio";
import type { TeamMember, WorkflowType } from "../lib/types";

const LOCK_FILE = ".keepr.lock";

function workflowLabel(workflow: string, targetName: string | null): string {
  const labels: Record<string, string> = {
    team_pulse: "Team pulse",
    one_on_one_prep: `1:1 prep${targetName ? ` (${targetName})` : ""}`,
    weekly_update: "Weekly engineering update",
    perf_evaluation: `Perf evaluation${targetName ? ` (${targetName})` : ""}`,
    promo_readiness: `Promo readiness${targetName ? ` (${targetName})` : ""}`,
  };
  return labels[workflow] || workflow;
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function humanDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// ---- Read path -----------------------------------------------------------

export async function readMemoryContext(args: {
  memoryDir: string;
  targetSlug: string | null;
  workflow: WorkflowType;
}): Promise<string> {
  if (!args.memoryDir) return "";

  const parts: string[] = [];

  const status = await readFileIfExists(await join(args.memoryDir, "status.md"));
  if (status) parts.push(`## status.md\n\n${status.trim()}`);

  const memory = await readFileIfExists(await join(args.memoryDir, "memory.md"));
  if (memory) {
    // Last ~60 days of entries. Simple heuristic: take last 6k chars.
    const tail = memory.slice(-6000);
    parts.push(`## memory.md (recent)\n\n${tail.trim()}`);
  }

  if (args.targetSlug) {
    const personFile = await readFileIfExists(
      await join(args.memoryDir, "people", `${args.targetSlug}.md`)
    );
    if (personFile) {
      parts.push(`## people/${args.targetSlug}.md\n\n${personFile.trim()}`);
    }
  }

  // Include recent topics for context
  try {
    const topicsDir = await join(args.memoryDir, "topics");
    // Read known topic files — we keep a lightweight scan by reading up to
    // 10 topic files (most recent by content length heuristic).
    const topicFiles = await listTopicFiles(topicsDir);
    for (const tf of topicFiles.slice(0, 10)) {
      const content = await readFileIfExists(await join(topicsDir, tf));
      if (content) {
        // Last ~2k chars per topic to keep context budget reasonable
        const tail = content.slice(-2000);
        parts.push(`## topics/${tf}\n\n${tail.trim()}`);
      }
    }
  } catch {
    // topics dir may not exist yet — that's fine
  }

  if (!parts.length) return "";
  return parts.join("\n\n---\n\n");
}

// ---- Delta parsing -------------------------------------------------------

interface MemoryDelta {
  personId: number;
  line: string;
}

function parseDeltas(markdown: string): MemoryDelta[] {
  const out: MemoryDelta[] = [];
  const lines = markdown.split("\n");
  let inDeltas = false;
  for (const line of lines) {
    if (/^##\s+Memory deltas/i.test(line)) {
      inDeltas = true;
      continue;
    }
    if (inDeltas && /^#{1,2}\s/.test(line)) break;
    if (!inDeltas) continue;
    const m = line.match(/^\s*-\s*\{person_id:\s*tm_(\d+)\}\s*(.+)$/);
    if (m) {
      out.push({ personId: Number(m[1]), line: m[2].trim() });
    }
  }
  return out;
}

function splitGeneratedOutput(markdown: string): string {
  // Strip the machine-parsed Memory deltas and Topics sections from the
  // user-visible session file — they're internal signals, not something
  // the EM wants cluttering their reading view.
  let result = markdown;
  const deltaIdx = result.search(/\n##\s+Memory deltas/i);
  if (deltaIdx > 0) result = result.slice(0, deltaIdx);
  const topicIdx = result.search(/\n##\s+Topics/i);
  if (topicIdx > 0) result = result.slice(0, topicIdx);
  return result.trimEnd();
}

// ---- Topic parsing --------------------------------------------------------

interface ParsedTopic {
  name: string;
  bullets: string[];
}

function parseTopics(markdown: string): ParsedTopic[] {
  const out: ParsedTopic[] = [];
  const lines = markdown.split("\n");
  let inTopics = false;
  let current: ParsedTopic | null = null;

  for (const line of lines) {
    if (/^##\s+Topics/i.test(line)) {
      inTopics = true;
      continue;
    }
    if (inTopics && /^#{1,2}\s/.test(line) && !/^###/.test(line)) {
      // Hit another ## heading — end of Topics section
      break;
    }
    if (!inTopics) continue;

    // ### Topic name
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      if (current && current.bullets.length) out.push(current);
      current = { name: heading[1].trim(), bullets: [] };
      continue;
    }

    // - bullet under current topic
    const bullet = line.match(/^\s*-\s+(.+)$/);
    if (bullet && current) {
      current.bullets.push(bullet[1].trim());
    }
  }

  if (current && current.bullets.length) out.push(current);
  return out;
}

// ---- Write path ----------------------------------------------------------

export interface PersistedEvidence {
  id: string;
  source: string;
  url: string;
  actor_display: string | null;
  timestamp: string;
  content: string;
}

export async function writeMemory(args: {
  memoryDir: string;
  workflow: WorkflowType;
  targetSlug: string | null;
  targetDisplayName: string | null;
  members: TeamMember[];
  markdown: string;
  evidence: PersistedEvidence[];
  timeRange: { start: string; end: string };
}): Promise<string> {
  await ensureDir(args.memoryDir);
  const lockPath = await join(args.memoryDir, LOCK_FILE);
  const got = await acquireLock(lockPath);
  if (!got) {
    throw new Error(
      "Keepr memory directory is locked by another run. If you're sure nothing else is running, delete .keepr.lock and retry."
    );
  }

  try {
    await ensureDir(await join(args.memoryDir, "sessions"));
    await ensureDir(await join(args.memoryDir, "people"));

    // ---- Session file ----
    const dateStamp = todayStamp();
    const workflowSlug: Record<string, string> = {
      team_pulse: "team-pulse",
      one_on_one_prep: `1on1-${args.targetSlug || "engineer"}`,
      weekly_update: "weekly-update",
      perf_evaluation: `perf-eval-${args.targetSlug || "engineer"}`,
      promo_readiness: `promo-readiness-${args.targetSlug || "engineer"}`,
    };
    const baseName = `${dateStamp}-${workflowSlug[args.workflow] || args.workflow}`;

    // Uniquify on same-day re-run.
    let sessionFile = await join(args.memoryDir, "sessions", `${baseName}.md`);
    let suffix = 2;
    while ((await fileMeta(sessionFile)).exists) {
      sessionFile = await join(args.memoryDir, "sessions", `${baseName}-${suffix}.md`);
      suffix += 1;
    }

    const visibleMarkdown = splitGeneratedOutput(args.markdown);
    const evidenceFooter = renderEvidenceFooter(args.evidence);
    const full = `${visibleMarkdown}\n\n---\n\n## Evidence\n\n${evidenceFooter}\n`;
    await writeFileAtomic(sessionFile, full);

    // ---- status.md (team pulse only) ----
    if (args.workflow === "team_pulse" || args.workflow === "weekly_update") {
      const statusPath = await join(args.memoryDir, "status.md");
      const manualSection = await extractManualSection(statusPath);
      const newStatus = [
        `# Status`,
        `*Last updated: ${new Date().toISOString()}*`,
        ``,
        `## Generated`,
        ``,
        visibleMarkdown,
        ``,
        `---`,
        ``,
        `## Manual notes`,
        ``,
        manualSection || "*(your notes here — Keepr will not overwrite this section)*",
        ``,
      ].join("\n");
      await conflictSafeWrite(statusPath, newStatus);
    }

    // ---- memory.md append ----
    const memoryPath = await join(args.memoryDir, "memory.md");
    const memoryEntry = [
      ``,
      `## ${dateStamp} — ${workflowLabel(args.workflow, args.targetDisplayName)}`,
      ``,
      firstFewSentences(visibleMarkdown),
      ``,
    ].join("\n");
    await appendMemoryFile(memoryPath, memoryEntry);

    // ---- people/*.md appends (facts-only, from Memory deltas) ----
    const deltas = parseDeltas(args.markdown);
    const byPerson = new Map<number, MemoryDelta[]>();
    for (const d of deltas) {
      const arr = byPerson.get(d.personId) || [];
      arr.push(d);
      byPerson.set(d.personId, arr);
    }
    for (const [personId, arr] of byPerson) {
      const member = args.members.find((m) => m.id === personId);
      if (!member) continue;
      const personPath = await join(args.memoryDir, "people", `${member.slug}.md`);
      const block = [
        ``,
        `## ${dateStamp} — ${workflowLabel(args.workflow, null)}`,
        ``,
        ...arr.map((d) => `- ${d.line}`),
        ``,
      ].join("\n");
      await appendMemoryFile(personPath, block, { header: `# ${member.display_name}\n\n` });
    }

    // ---- topics/*.md appends (auto-created from ## Topics section) ----
    const topics = parseTopics(args.markdown);
    if (topics.length) {
      await ensureDir(await join(args.memoryDir, "topics"));
      for (const topic of topics) {
        const topicSlug = slugify(topic.name);
        const topicPath = await join(args.memoryDir, "topics", `${topicSlug}.md`);
        const block = [
          ``,
          `## ${dateStamp} — ${workflowLabel(args.workflow, args.targetDisplayName)}`,
          ``,
          ...topic.bullets.map((b) => `- ${b}`),
          ``,
        ].join("\n");
        await appendMemoryFile(topicPath, block, { header: `# ${topic.name}\n\n` });
      }
    }

    return sessionFile;
  } finally {
    await releaseLock(lockPath);
  }
}

function renderEvidenceFooter(evidence: PersistedEvidence[]): string {
  return evidence
    .map((e) => {
      const snippet = e.content.replace(/\s+/g, " ").slice(0, 220);
      const who = e.actor_display ? `${e.actor_display} · ` : "";
      return `- [^${e.id}] ${who}${e.source} · [${new Date(e.timestamp).toLocaleString()}](${e.url})\n  > ${snippet}`;
    })
    .join("\n");
}

function firstFewSentences(md: string): string {
  // Pull the first meaningful paragraph after the title.
  const lines = md.split("\n").filter((l) => l.trim());
  const body = lines.filter((l) => !l.startsWith("#")).slice(0, 6).join(" ");
  const clean = body.replace(/\[\^ev_\d+\]/g, "").replace(/\s+/g, " ").trim();
  return clean.slice(0, 420) + (clean.length > 420 ? "…" : "");
}

async function extractManualSection(statusPath: string): Promise<string> {
  const existing = await readFileIfExists(statusPath);
  if (!existing) return "";
  const idx = existing.search(/##\s+Manual notes/i);
  if (idx < 0) return "";
  const after = existing.slice(idx);
  const lines = after.split("\n").slice(1); // drop the heading
  return lines.join("\n").trim();
}

async function conflictSafeWrite(path: string, contents: string): Promise<void> {
  // Detect concurrent external edits. If the file changed from what we
  // saw when we started this run, drop the new content to .pending and
  // let the UI banner surface the conflict.
  const meta = await fileMeta(path);
  if (meta.exists) {
    // In v1 we do a best-effort check — just write the pending file if the
    // file has been modified in the last 30 seconds (likely while Keepr was
    // thinking and an external editor was saving).
    const ageMs = Date.now() - meta.mtime_ms;
    if (ageMs < 30_000) {
      const prior = await readFileIfExists(path);
      if (prior && prior.trim() !== contents.trim()) {
        await writeFileAtomic(`${path}.pending`, contents);
        return;
      }
    }
  }
  await writeFileAtomic(path, contents);
}

async function listTopicFiles(topicsDir: string): Promise<string[]> {
  return listMdFiles(topicsDir);
}

async function appendMemoryFile(
  path: string,
  block: string,
  opts: { header?: string } = {}
): Promise<void> {
  const prior = await readFileIfExists(path);
  const seed = prior ?? opts.header ?? "";
  const next = seed.endsWith("\n") || seed === "" ? seed + block : seed + "\n" + block;
  await conflictSafeWrite(path, next);
}
