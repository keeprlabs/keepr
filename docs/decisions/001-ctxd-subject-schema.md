# ADR-001: ctxd subject schema

**Status:** accepted (2026-04-29)
**Decides:** the canonical subject paths and event-type vocabulary Keepr writes into ctxd.
**Related:** ADR-002 (lifecycle), `tasks/ctxd-integration.md`, `src/services/ctxSubjects.ts`.

---

## Context

ctxd uses subject-based addressing — every event is filed under a hierarchical path like `/work/acme/notes/standup`. Subjects are forward-slash separated, glob-matchable, and **immutable in practice**: changing a subject after events have been written means rewriting history (or living with two parallel schemas).

Keepr v0.2.7 begins dual-writing events into ctxd alongside the existing markdown store. This is the moment the subject layout becomes a public contract — once we've shipped a build that writes events under `/keepr/people/{uuid}`, every future read or query has to honour that path.

We need to decide:
1. The top-level namespace split (Keepr-owned vs adapter-owned).
2. The path shape for each Keepr concept (people, sessions, topics, follow-ups, status, evidence).
3. Which ID strategy to use per concept (slug vs UUID vs DB id).
4. The canonical event-type vocabulary.
5. A versioning policy for non-additive changes.

## Decision

### 1. Namespace split

| Prefix | Owner | Purpose |
|---|---|---|
| `/keepr/**` | Keepr | Keepr-domain events: people, sessions, topics, follow-ups, status, bridge evidence. |
| `/work/**` | adapters | Adapter-owned events from `ctxd-adapter-*` binaries (e.g. `/work/github/{owner}/{repo}/pulls/{n}`). |
| `/keepr/evidence/{source}/...` | Keepr (bridge) | Evidence from sources that don't yet have a ctxd adapter (slack, jira, linear, gitlab; **also github until `ctxd-adapter-github` ships as a binary**). When the real adapter lands upstream, those events move to `/work/{source}/**` and a one-time consolidation rewrites references. |

Keepr code never writes under `/work` — that's the adapter's namespace. Until upstream ships adapter binaries, our TS fetchers write to the bridge namespace via `memory_write`.

### 2. Path shapes

| Concept | Subject | ID strategy |
|---|---|---|
| Team member | `/keepr/people/{uuid}` | UUID (see §3) |
| Session | `/keepr/sessions/{yyyy-mm-dd}/{workflow}/{slug}` | composite |
| Topic | `/keepr/topics/{slug}` | kebab-case slug |
| Follow-up | `/keepr/followups/{id}` | local DB integer id |
| Status snapshot | `/keepr/status` | singleton |
| Evidence (bridge) | `/keepr/evidence/{source}/{...natural id}` | source-defined |

The full path-builder surface lives in `src/services/ctxSubjects.ts`. Every helper has a frozen golden test.

### 3. Person IDs are UUIDs, not slugs

`team_members.slug` is derived from `display_name` and changes whenever a person is renamed. Subjects don't change. If we used the slug, every rename would either:
- silently leave events under the old subject and "lose" them on the new path, or
- require rewriting history.

UUIDs make the subject immutable. Display names live as event fields (`person.created`, `person.updated`).

The UUID is generated lazily on the first event write per person and cached in `team_members.ctxd_uuid` (migration #10). Slugs continue to drive human-readable URLs in the UI; the slug→uuid lookup happens at write time.

### 4. Canonical event-type vocabulary

Defined in `EVENT_TYPES` (in `ctxSubjects.ts`):

```
PERSON_CREATED   = "person.created"
PERSON_UPDATED   = "person.updated"
PERSON_FACT      = "person.fact"
SESSION_STARTED  = "session.started"
SESSION_COMPLETED = "session.completed"
SESSION_FAILED   = "session.failed"
TOPIC_NOTE       = "topic.note"
TOPIC_UPDATED    = "topic.updated"
FOLLOWUP_OPENED  = "followup.opened"
FOLLOWUP_CARRIED = "followup.carried"
FOLLOWUP_RESOLVED = "followup.resolved"
STATUS_UPDATED   = "status.updated"
EVIDENCE_RECORDED = "evidence.recorded"
```

Lowercase, dot-separated, two segments: `{noun}.{verb}`. Each event carries a `schema_version` field; see §5.

Adding a new type is fine. Renaming or removing one is a schema change.

### 5. Versioning policy

Every event written by Keepr carries a `schema_version: u32` field in its `data` payload. Current value: `1`.

Bump rules:
- **Additive change** (new event type, new optional data field): no version bump. Old readers ignore unknown fields.
- **Breaking change** (rename event type, restructure subject path, remove a required field): bump `SCHEMA_VERSION` and write a new ADR documenting the migration. Reads must handle both old and new during the transition window.
- **Subject-path changes**: a separate concern from schema version because they affect addressing, not payload shape. A subject rename requires a coordinated rewrite or living-with-two-schemas decision; see the v0.4 markdown-import plan for an example.

We do not (yet) emit a `schema_version` event upgrader pipeline. v0.4 may add `ctxd migrate`-style schema rewrites; until then we live with whatever's in the log.

### 6. Schema-lock-in surface

The contract is the union of:
- The path-builder functions in `src/services/ctxSubjects.ts`.
- The `EVENT_TYPES` constants in the same file.
- The golden test in `src/services/__tests__/ctxSubjects.test.ts`.

Any change to these without a corresponding ADR update is a contract violation and must be reverted.

## Consequences

**Good:**
- Subject paths are stable — renames don't invalidate history.
- The `/keepr` vs `/work` split keeps Keepr from accidentally writing into adapter-owned namespaces.
- The bridge namespace gives us a clean migration path when upstream adapters ship.
- Every helper is golden-tested; future drift fails CI loudly.

**Bad:**
- UUIDs in URLs are uglier than slugs. Mitigated by keeping slugs in the UI URL layer; ctxd subjects are an internal addressing scheme.
- Two namespaces for github (`/work/github/**` reserved, `/keepr/evidence/github/**` actually used today) means the v0.4 GitHub adapter ship needs a one-time consolidation pass. Acceptable cost; the adapter ships once.

**Neutral:**
- The schema_version field will be ignored for the foreseeable future. We just want it in the log so a v0.4 migrator has something to read.

## Alternatives considered

### A. Use slugs as person IDs

Rejected. Renames break addressing. Every team has at least one person rename in its lifetime.

### B. Use the integer DB id as person subject

Rejected. Database ids are an implementation detail. If we ever rebuild from external sources or merge two installations (federation), ids collide and subjects break.

### C. Mirror ctxd's recommended namespaces verbatim

Rejected. ctxd's documentation suggests `/work/...` patterns, but those are adapter-owned. Keepr is its own domain; squatting on `/work` for Keepr-domain events would conflict with adapter writes.

### D. Skip `schema_version` and rely on event-type names

Rejected for a future-proofing reason. Event-type renames are sometimes necessary; carrying an explicit version makes the migration tractable.

## Validation

Frozen by `src/services/__tests__/ctxSubjects.test.ts`. Future changes that break the schema fail tests with a "renamed contract" diff.

The first dual-write of real Keepr events lands in v0.2.7 PR 3 alongside this ADR. Any subject-path change after that PR ships requires a new ADR.
