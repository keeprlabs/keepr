// Canonical ctxd subject paths and event types for Keepr's domain.
//
// **PUBLIC CONTRACT.** Once events are written under these paths, renaming
// means rewriting history. Treat this file like an API surface — additive
// changes only. See `docs/decisions/001-ctxd-subject-schema.md` for the
// versioning policy and `tasks/ctxd-integration.md` for the broader plan.
//
// All functions are pure and total. The golden test in
// `__tests__/ctxSubjects.test.ts` freezes every output path; future
// renames will fail loudly.

/** Schema version embedded in every event we write. Bump when the
 *  subject layout or event-type set changes in a non-additive way. */
export const SCHEMA_VERSION = 1;

/** Top-level subject namespaces.
 *  - `/keepr/**` — Keepr-owned events (people, sessions, topics, ...).
 *  - `/work/**` — adapter-owned events (e.g. ctxd-adapter-github writes
 *    `/work/github/{owner}/{repo}/pulls/{n}`). We never write under
 *    `/work` from Keepr code; that's the adapter's namespace.
 *  - `/keepr/evidence/{source}/...` — bridge namespace for sources where
 *    no upstream ctxd adapter exists yet (slack, jira, linear, gitlab).
 *    When the real adapter ships, those move to `/work/{source}/...` and
 *    a one-time consolidation rewrites references. */
export const ROOT = "/keepr";

// ---------- Person ------------------------------------------------------

/** `/keepr/people/{uuid}` — the team member's stable ctxd subject.
 *
 *  IDs are UUIDs (not slugs) because slugs change on rename and ctxd
 *  subjects are immutable in practice. The UUID is generated lazily on
 *  first event write per person and cached in `team_members.ctxd_uuid`
 *  (migration #10). The display name is carried as a `person.created`
 *  / `person.updated` event field, NOT in the subject. */
export function personSubject(ctxdUuid: string): string {
  assertUuid(ctxdUuid, "personSubject");
  return `${ROOT}/people/${ctxdUuid}`;
}

// ---------- Session ----------------------------------------------------

/** `/keepr/sessions/{yyyy-mm-dd}/{workflow}/{slug}` */
export function sessionSubject(
  isoDate: string,
  workflow: string,
  slug: string
): string {
  assertDateStamp(isoDate);
  assertNonEmpty(workflow, "workflow");
  assertNonEmpty(slug, "slug");
  return `${ROOT}/sessions/${isoDate}/${workflow}/${slug}`;
}

// ---------- Topic ------------------------------------------------------

/** `/keepr/topics/{slug}` — slug is the human-readable topic identifier
 *  (kebab-case). Topics are renameable in principle, but in practice
 *  Keepr derives slugs from headings and rarely renames. */
export function topicSubject(topicSlug: string): string {
  assertNonEmpty(topicSlug, "topicSlug");
  return `${ROOT}/topics/${topicSlug}`;
}

// ---------- Follow-up --------------------------------------------------

/** `/keepr/followups/{id}` — `id` is the local DB integer id as a string.
 *  Stable for the life of the row (we never renumber). */
export function followupSubject(id: number | string): string {
  const s = String(id).trim();
  if (!s) throw new Error("followupSubject: empty id");
  return `${ROOT}/followups/${s}`;
}

// ---------- Status snapshot --------------------------------------------

/** `/keepr/status` — the singleton "latest team status" subject. Each
 *  team_pulse / weekly_update writes a `status.updated` event here. */
export function statusSubject(): string {
  return `${ROOT}/status`;
}

// ---------- Evidence (bridge namespace) --------------------------------

/** `/keepr/evidence/{source}/{...rest}` — for sources that don't yet
 *  have a ctxd adapter (slack, jira, linear, gitlab). `parts` is the
 *  natural identifier hierarchy for that source. Examples:
 *
 *    evidenceSubject("slack", ["channel-id", "ts"])
 *      → "/keepr/evidence/slack/channel-id/ts"
 *
 *    evidenceSubject("github", ["acme", "web", "pulls", "42"])
 *      → "/keepr/evidence/github/acme/web/pulls/42"
 *      (until ctxd-adapter-github ships and we move to /work/github/**)
 */
export function evidenceSubject(source: string, parts: string[]): string {
  assertNonEmpty(source, "source");
  if (!parts.length) throw new Error("evidenceSubject: parts must be non-empty");
  for (const p of parts) {
    if (!p || p.includes("/")) {
      throw new Error(`evidenceSubject: invalid path part: ${JSON.stringify(p)}`);
    }
  }
  return `${ROOT}/evidence/${source}/${parts.join("/")}`;
}

/** Convenience for the existing `EvidenceItem.source` enum + the
 *  natural id columns. Returns `null` for sources we don't know how
 *  to subject yet (caller should leave `subject_path` NULL). */
export function evidenceSubjectFor(
  source: string,
  sourceId: string,
  sourceUrl: string | null
): string | null {
  // ctxd-adapter-github (when it ships) will own /work/github/**. Until
  // then we use the bridge namespace.
  switch (source) {
    case "github_pr":
    case "github_review": {
      // source_url shape: https://github.com/{owner}/{repo}/pull/{n}[#review-...]
      // We extract owner/repo/n; everything else collapses to a single
      // id segment to keep paths sane. source_id often carries embedded
      // "/" (e.g. "acme/web#42:review/12345") so we escape like slack.
      const m = sourceUrl?.match(/github\.com\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/);
      if (!m) return null;
      const [_, owner, repo, n] = m;
      const kind = source === "github_pr" ? "pulls" : "reviews";
      return evidenceSubject("github", [owner, repo, kind, n, sourceId.replace(/\//g, "_")]);
    }
    case "gitlab_mr":
    case "gitlab_review": {
      const m = sourceUrl?.match(/\/([^/]+\/[^/]+)\/-\/merge_requests\/(\d+)/);
      if (!m) return null;
      const [_, project, n] = m;
      const kind = source === "gitlab_mr" ? "mrs" : "reviews";
      return evidenceSubject("gitlab", [...project.split("/"), kind, n, sourceId.replace(/\//g, "_")]);
    }
    case "slack_message": {
      // sourceId carries the channel.ts; that's enough for uniqueness.
      const safeId = sourceId.replace(/\//g, "_");
      return evidenceSubject("slack", [safeId]);
    }
    case "jira_issue":
    case "jira_comment": {
      const safeId = sourceId.replace(/\//g, "_");
      const kind = source === "jira_issue" ? "issues" : "comments";
      return evidenceSubject("jira", [kind, safeId]);
    }
    case "linear_issue":
    case "linear_comment": {
      const safeId = sourceId.replace(/\//g, "_");
      const kind = source === "linear_issue" ? "issues" : "comments";
      return evidenceSubject("linear", [kind, safeId]);
    }
    default:
      return null;
  }
}

// ---------- Event types -------------------------------------------------

export const EVENT_TYPES = {
  // Person.
  PERSON_CREATED: "person.created",
  PERSON_UPDATED: "person.updated",
  PERSON_FACT: "person.fact",
  // Session.
  SESSION_STARTED: "session.started",
  SESSION_COMPLETED: "session.completed",
  SESSION_FAILED: "session.failed",
  // Topic.
  TOPIC_NOTE: "topic.note",
  TOPIC_UPDATED: "topic.updated",
  // Follow-up.
  FOLLOWUP_OPENED: "followup.opened",
  FOLLOWUP_CARRIED: "followup.carried",
  FOLLOWUP_RESOLVED: "followup.resolved",
  // Status.
  STATUS_UPDATED: "status.updated",
  // Evidence (bridge).
  EVIDENCE_RECORDED: "evidence.recorded",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

// ---------- Validators -------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(v: string, where: string): void {
  if (!UUID_REGEX.test(v)) {
    throw new Error(`${where}: not a valid UUID: ${JSON.stringify(v)}`);
  }
}

function assertDateStamp(v: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(`sessionSubject: date must be YYYY-MM-DD, got ${JSON.stringify(v)}`);
  }
}

function assertNonEmpty(v: string, name: string): void {
  if (!v || !v.trim()) throw new Error(`${name} must be non-empty`);
  if (v.includes("/")) throw new Error(`${name} must not contain '/': ${JSON.stringify(v)}`);
}
