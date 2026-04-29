// Golden tests for the ctxd subject schema. Every output path is
// frozen — future renames will fail this test loudly.
//
// PUBLIC CONTRACT. See docs/decisions/001-ctxd-subject-schema.md.

import { describe, expect, it } from "vitest";
import {
  personSubject,
  sessionSubject,
  topicSubject,
  followupSubject,
  statusSubject,
  evidenceSubject,
  evidenceSubjectFor,
  EVENT_TYPES,
  ROOT,
  SCHEMA_VERSION,
} from "../ctxSubjects";

describe("ctxSubjects — golden paths", () => {
  it("ROOT is /keepr", () => {
    expect(ROOT).toBe("/keepr");
  });

  it("SCHEMA_VERSION is 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("personSubject", () => {
    expect(personSubject("01900000-0000-7000-8000-000000000001")).toBe(
      "/keepr/people/01900000-0000-7000-8000-000000000001"
    );
  });

  it("sessionSubject", () => {
    expect(sessionSubject("2026-04-28", "team_pulse", "weekly")).toBe(
      "/keepr/sessions/2026-04-28/team_pulse/weekly"
    );
    expect(sessionSubject("2026-04-28", "one_on_one_prep", "priya-raman")).toBe(
      "/keepr/sessions/2026-04-28/one_on_one_prep/priya-raman"
    );
  });

  it("topicSubject", () => {
    expect(topicSubject("auth-rewrite")).toBe("/keepr/topics/auth-rewrite");
  });

  it("followupSubject — accepts number or string", () => {
    expect(followupSubject(42)).toBe("/keepr/followups/42");
    expect(followupSubject("42")).toBe("/keepr/followups/42");
  });

  it("statusSubject is a singleton", () => {
    expect(statusSubject()).toBe("/keepr/status");
  });

  it("evidenceSubject — github bridge", () => {
    expect(evidenceSubject("github", ["acme", "web", "pulls", "42"])).toBe(
      "/keepr/evidence/github/acme/web/pulls/42"
    );
  });

  it("evidenceSubject — slack bridge", () => {
    expect(evidenceSubject("slack", ["C123.456"])).toBe(
      "/keepr/evidence/slack/C123.456"
    );
  });
});

describe("ctxSubjects — validators", () => {
  it("personSubject rejects non-UUID", () => {
    expect(() => personSubject("not-a-uuid")).toThrow(/UUID/);
    expect(() => personSubject("")).toThrow(/UUID/);
  });

  it("sessionSubject rejects malformed date", () => {
    expect(() => sessionSubject("April 28", "team_pulse", "weekly")).toThrow(/YYYY-MM-DD/);
    expect(() => sessionSubject("2026-4-28", "team_pulse", "weekly")).toThrow(/YYYY-MM-DD/);
  });

  it("sessionSubject rejects empty workflow / slug", () => {
    expect(() => sessionSubject("2026-04-28", "", "x")).toThrow(/workflow/);
    expect(() => sessionSubject("2026-04-28", "team_pulse", "")).toThrow(/slug/);
  });

  it("sessionSubject rejects '/' in path parts", () => {
    expect(() => sessionSubject("2026-04-28", "team/pulse", "x")).toThrow(/'\/'/);
  });

  it("topicSubject rejects empty / slashed slug", () => {
    expect(() => topicSubject("")).toThrow(/topicSlug/);
    expect(() => topicSubject("a/b")).toThrow(/'\/'/);
  });

  it("followupSubject rejects empty id", () => {
    expect(() => followupSubject("")).toThrow(/empty id/);
    expect(() => followupSubject("   ")).toThrow(/empty id/);
  });

  it("evidenceSubject rejects empty parts and '/' in parts", () => {
    expect(() => evidenceSubject("github", [])).toThrow(/parts/);
    expect(() => evidenceSubject("github", ["a", "b/c"])).toThrow(/invalid path part/);
    expect(() => evidenceSubject("", ["a"])).toThrow(/source/);
  });
});

describe("ctxSubjects — evidenceSubjectFor", () => {
  it("github_pr extracts owner/repo/number from URL", () => {
    expect(
      evidenceSubjectFor(
        "github_pr",
        "ev-1",
        "https://github.com/acme/web/pull/42"
      )
    ).toBe("/keepr/evidence/github/acme/web/pulls/42/ev-1");
  });

  it("github_review same shape with reviews kind", () => {
    expect(
      evidenceSubjectFor(
        "github_review",
        "ev-2",
        "https://github.com/acme/web/pull/42#pullrequestreview-99"
      )
    ).toBe("/keepr/evidence/github/acme/web/reviews/42/ev-2");
  });

  it("gitlab_mr extracts project path and MR number", () => {
    expect(
      evidenceSubjectFor(
        "gitlab_mr",
        "ev-3",
        "https://gitlab.com/group/project/-/merge_requests/7"
      )
    ).toBe("/keepr/evidence/gitlab/group/project/mrs/7/ev-3");
  });

  it("slack_message escapes / in source_id", () => {
    expect(evidenceSubjectFor("slack_message", "C123/456.789", null)).toBe(
      "/keepr/evidence/slack/C123_456.789"
    );
  });

  it("jira and linear use kind segment", () => {
    expect(evidenceSubjectFor("jira_issue", "PROJ-123", null)).toBe(
      "/keepr/evidence/jira/issues/PROJ-123"
    );
    expect(evidenceSubjectFor("linear_comment", "abc-def", null)).toBe(
      "/keepr/evidence/linear/comments/abc-def"
    );
  });

  it("returns null for unknown sources", () => {
    expect(evidenceSubjectFor("unknown_source", "x", null)).toBeNull();
  });

  it("returns null when github URL is malformed", () => {
    expect(evidenceSubjectFor("github_pr", "ev-x", "https://example.com/bad")).toBeNull();
  });
});

describe("ctxSubjects — EVENT_TYPES", () => {
  it("freezes the canonical event-type set", () => {
    // Golden snapshot — adding a new type is fine; renaming or
    // removing one is a schema change requiring an ADR update.
    expect(EVENT_TYPES).toEqual({
      PERSON_CREATED: "person.created",
      PERSON_UPDATED: "person.updated",
      PERSON_FACT: "person.fact",
      SESSION_STARTED: "session.started",
      SESSION_COMPLETED: "session.completed",
      SESSION_FAILED: "session.failed",
      TOPIC_NOTE: "topic.note",
      TOPIC_UPDATED: "topic.updated",
      FOLLOWUP_OPENED: "followup.opened",
      FOLLOWUP_CARRIED: "followup.carried",
      FOLLOWUP_RESOLVED: "followup.resolved",
      STATUS_UPDATED: "status.updated",
      EVIDENCE_RECORDED: "evidence.recorded",
    });
  });
});
