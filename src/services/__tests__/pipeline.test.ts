// Tests for runWorkflow's outcome shape (Step 2 of pulse-outcome-states).
//
// Test #1 keeps the "no sources configured" thrown error path locked.
// Tests #2-#9 cover the new PulseOutcome return: empty / partial_failure /
// total_failure / ready, the per-kind aggregation rules, the session
// lifecycle (D1: ready/partial → complete, total → failed, empty → delete),
// the abort-mid-flight regression, and the no-throw-on-empty contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../lib/types";
import { DEFAULT_CONFIG } from "../../lib/types";

// ---- Mocks ---------------------------------------------------------------

let fakeConfig: AppConfig;

const setSessionStatus = vi.fn(async () => {});
const deleteSession = vi.fn(async () => {});
const updateSession = vi.fn(async () => {});

vi.mock("../db", () => ({
  getConfig: vi.fn(async () => fakeConfig),
  listMembers: vi.fn(async () => []),
  createSession: vi.fn(async () => 1),
  setSessionStatus: (...a: unknown[]) => setSessionStatus(...(a as [])),
  deleteSession: (...a: unknown[]) => deleteSession(...(a as [])),
  updateSession: (...a: unknown[]) => updateSession(...(a as [])),
  insertEvidence: vi.fn(async () => 1),
  insertPersonFacts: vi.fn(async () => {}),
  upsertIntegration: vi.fn(async () => {}),
}));

const fetchRepoActivity = vi.fn();
vi.mock("../github", () => ({
  fetchRepoActivity: (...a: unknown[]) => fetchRepoActivity(...a),
}));

const slackAuthTest = vi.fn(async () => ({ team: "t", user: "u", team_id: "T1" }));
const fetchChannelHistory = vi.fn();
vi.mock("../slack", () => ({
  authTest: (...a: unknown[]) => slackAuthTest(...(a as [])),
  fetchChannelHistory: (...a: unknown[]) => fetchChannelHistory(...a),
}));

const fetchProjectActivity = vi.fn();
vi.mock("../jira", () => ({
  fetchProjectActivity: (...a: unknown[]) => fetchProjectActivity(...a),
}));

const fetchTeamActivity = vi.fn();
vi.mock("../linear", () => ({
  fetchTeamActivity: (...a: unknown[]) => fetchTeamActivity(...a),
}));

vi.mock("../llm", () => ({
  getProvider: vi.fn(() => ({
    defaultSynthesisModel: "x",
    defaultClassifierModel: "y",
  })),
  setCustomConfig: vi.fn(),
}));

vi.mock("../memory", () => ({
  writeMemory: vi.fn(async () => "/tmp/out.md"),
  readMemoryContext: vi.fn(async () => ""),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
}));

import { runWorkflow } from "../pipeline";

// ---- Helpers -------------------------------------------------------------

beforeEach(() => {
  fakeConfig = { ...DEFAULT_CONFIG };
  fetchRepoActivity.mockReset();
  fetchChannelHistory.mockReset();
  fetchProjectActivity.mockReset();
  fetchTeamActivity.mockReset();
  setSessionStatus.mockClear();
  deleteSession.mockClear();
  updateSession.mockClear();
});

afterEach(() => {
  vi.clearAllTimers();
});

function configWith(opts: {
  github?: number;
  slack?: number;
  jira?: number;
  linear?: number;
}) {
  fakeConfig = {
    ...DEFAULT_CONFIG,
    selected_github_repos: Array.from({ length: opts.github ?? 0 }, (_, i) => ({
      owner: "acme",
      repo: `repo${i}`,
    })),
    selected_slack_channels: Array.from({ length: opts.slack ?? 0 }, (_, i) => ({
      id: `C${i}`,
      name: `chan${i}`,
    })),
    selected_jira_projects: Array.from({ length: opts.jira ?? 0 }, (_, i) => ({
      id: `${i}`,
      key: `PROJ${i}`,
      name: `Proj ${i}`,
    })),
    selected_linear_teams: Array.from({ length: opts.linear ?? 0 }, (_, i) => ({
      id: `${i}`,
      key: `T${i}`,
      name: `Team ${i}`,
    })),
  };
}

// ---- Tests ---------------------------------------------------------------

describe("runWorkflow — source-validation errors", () => {
  it("#1 REGRESSION no sources configured — throws with Open Settings copy", async () => {
    await expect(
      runWorkflow({ workflow: "team_pulse", daysBack: 7 })
    ).rejects.toThrow(/Open Settings and connect at least one/);
  });
});

describe("runWorkflow — outcome shape", () => {
  it("#2 all sources ok_empty → kind: 'empty', sources all ok_empty, session deleted", async () => {
    configWith({ github: 5, slack: 9, jira: 4, linear: 1 });
    fetchRepoActivity.mockResolvedValue([]);
    fetchChannelHistory.mockResolvedValue([]);
    fetchProjectActivity.mockResolvedValue([]);
    fetchTeamActivity.mockResolvedValue([]);

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 14 });

    expect(outcome.kind).toBe("empty");
    expect(outcome.sources).toHaveLength(4);
    expect(outcome.sources.every((s) => s.status === "ok_empty")).toBe(true);
    expect(outcome.windowDays).toBe(14);
    // D1: empty → deleteSession, no setSessionStatus
    expect(deleteSession).toHaveBeenCalledWith(1);
  });

  it("#3 Slack throws not_in_channel × all, others ok_empty → 'partial_failure', slack error, others ok_empty, session marked complete", async () => {
    configWith({ github: 1, slack: 9, jira: 1, linear: 1 });
    fetchRepoActivity.mockResolvedValue([]);
    fetchChannelHistory.mockRejectedValue(
      new Error("Slack conversations.history: not_in_channel")
    );
    fetchProjectActivity.mockResolvedValue([]);
    fetchTeamActivity.mockResolvedValue([]);

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 14 });

    expect(outcome.kind).toBe("partial_failure");
    const slack = outcome.sources.find((s) => s.kind === "slack");
    expect(slack?.status).toBe("error");
    if (slack?.status === "error") {
      expect(slack.errorKind).toBe("not_in_channel");
      expect(slack.failedCount).toBe(9);
      expect(slack.fixAction).toBe("invite_bot");
    }
    expect(
      outcome.sources.find((s) => s.kind === "github")?.status
    ).toBe("ok_empty");
    // D1: partial_failure → marked complete (some kinds did work — empty isn't broken)
    expect(setSessionStatus).toHaveBeenCalledWith(1, "complete");
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it("#4 RULE 4 unit — same kind has both ok_empty and errors, aggregator picks error (no data overall)", async () => {
    // We can't easily reach the synthesize path without mocking LLM, so
    // exercise the rule via a multi-source-same-kind GitHub setup. 2 repos:
    // first returns 2 PRs, second throws. Pipeline aggregates: github = ok_data
    // with itemCount=2. Since allItems > 0, pipeline tries to continue.
    configWith({ github: 2, slack: 0, jira: 0, linear: 0 });
    fetchRepoActivity
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("GitHub /repos/x: 401 Bad credentials"));
    // allItems is empty here — we set up "first ok_empty, second error".
    // After aggregation: github = error (no data, has errors).
    // Outcome: total_failure (only one kind, all errors after aggregation? No,
    // we have 1 ok_empty + 1 error within github → aggregator picks error).
    // Then no other kinds → outcome = total_failure.

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 7 });

    // Wait — within-kind aggregation rule: if subset has at least one error
    // and no ok_data, kind becomes error. So github = error.
    // Outcome: only github kind, status error → total_failure.
    expect(outcome.kind).toBe("total_failure");
    const gh = outcome.sources.find((s) => s.kind === "github");
    expect(gh?.status).toBe("error");
    if (gh?.status === "error") {
      expect(gh.errorKind).toBe("unauthorized");
      expect(gh.failedCount).toBe(1);
    }
  });

  it("#5 all fetchers throw non-abort → 'total_failure', every kind error, session failed", async () => {
    configWith({ github: 1, slack: 1, jira: 1, linear: 1 });
    fetchRepoActivity.mockRejectedValue(
      new Error("GitHub /repos/x: 401 Bad credentials")
    );
    fetchChannelHistory.mockRejectedValue(
      new Error("Slack conversations.history: invalid_auth")
    );
    fetchProjectActivity.mockRejectedValue(
      new Error("Jira /search: 401 Unauthorized")
    );
    fetchTeamActivity.mockRejectedValue(
      new Error("Linear API: Authentication failed")
    );

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 14 });

    expect(outcome.kind).toBe("total_failure");
    expect(outcome.sources).toHaveLength(4);
    expect(outcome.sources.every((s) => s.status === "error")).toBe(true);
    expect(setSessionStatus).toHaveBeenCalledWith(
      1,
      "failed",
      "Every source returned an error"
    );
  });

  it("#6 CRITICAL REGRESSION abort mid-flight after some succeed → still rejects with abort, NOT a partial_failure", async () => {
    configWith({ github: 1, slack: 1, jira: 0, linear: 0 });
    const controller = new AbortController();

    fetchRepoActivity.mockImplementationOnce(async () => {
      // First fetch succeeds.
      return [];
    });
    fetchChannelHistory.mockImplementationOnce(async () => {
      // Trigger abort mid-flight — abort the controller, then throw an
      // AbortError-shaped error so isAbortError() recognizes it.
      controller.abort();
      const e: any = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });

    await expect(
      runWorkflow({ workflow: "team_pulse", daysBack: 7, signal: controller.signal })
    ).rejects.toThrow(/abort/i);
  });

  it("#7 within-kind: 9 × not_in_channel → errorKind 'not_in_channel' (consistent), failedCount 9", async () => {
    configWith({ slack: 9 });
    fetchChannelHistory.mockRejectedValue(
      new Error("Slack conversations.history: not_in_channel")
    );

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 7 });

    expect(outcome.kind).toBe("total_failure");
    const slack = outcome.sources.find((s) => s.kind === "slack");
    if (slack?.status === "error") {
      expect(slack.errorKind).toBe("not_in_channel");
      expect(slack.failedCount).toBe(9);
    } else {
      throw new Error("expected slack to be in error state");
    }
  });

  it("#8 within-kind: mixed errors (not_in_channel + invalid_auth) → errorKind 'mixed'", async () => {
    configWith({ slack: 4 });
    fetchChannelHistory
      .mockRejectedValueOnce(new Error("Slack conversations.history: not_in_channel"))
      .mockRejectedValueOnce(new Error("Slack conversations.history: not_in_channel"))
      .mockRejectedValueOnce(new Error("Slack conversations.history: invalid_auth"))
      .mockRejectedValueOnce(new Error("Slack conversations.history: invalid_auth"));

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 7 });

    const slack = outcome.sources.find((s) => s.kind === "slack");
    if (slack?.status === "error") {
      expect(slack.errorKind).toBe("mixed");
      expect(slack.failedCount).toBe(4);
      expect(slack.detail).toMatch(/^4 sources failed/);
      expect(slack.fixAction).toBe("settings");
    } else {
      throw new Error("expected slack to be in error state");
    }
  });

  it("#9 within-kind: 7 ok_empty + 2 not_in_channel (no ok_data) → kind error, failedCount 2", async () => {
    configWith({ slack: 9 });
    let i = 0;
    fetchChannelHistory.mockImplementation(async () => {
      i++;
      if (i <= 7) return [];
      throw new Error("Slack conversations.history: not_in_channel");
    });

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 7 });

    // Within slack (only kind): 7 ok_empty + 2 not_in_channel. Aggregator
    // rule 3 ("at least one error AND no data") → kind = error, errorKind =
    // not_in_channel (consistent), failedCount = 2 (just the errors, not the
    // empties). Outcome classification looks at PER-KIND statuses: only
    // slack kind, all configured kinds are "error" → total_failure.
    expect(outcome.kind).toBe("total_failure");
    const slack = outcome.sources.find((s) => s.kind === "slack");
    if (slack?.status === "error") {
      expect(slack.errorKind).toBe("not_in_channel");
      expect(slack.failedCount).toBe(2);
      expect(slack.sourceCount).toBe(9);
    } else {
      throw new Error("expected slack error");
    }
  });

  it("#10 windowDays propagates from opts to outcome", async () => {
    configWith({ github: 1 });
    fetchRepoActivity.mockResolvedValue([]);

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 30 });

    expect(outcome.windowDays).toBe(30);
  });

  it("#11 skipped kinds (count 0) do not appear in outcome.sources", async () => {
    configWith({ github: 1, slack: 0, jira: 0, linear: 0 });
    fetchRepoActivity.mockResolvedValue([]);

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 7 });

    expect(outcome.sources).toHaveLength(1);
    expect(outcome.sources[0].kind).toBe("github");
  });

  it("#12 sourceCount on each row reflects cfg, not result count", async () => {
    configWith({ github: 5 });
    fetchRepoActivity.mockResolvedValue([]);

    const outcome = await runWorkflow({ workflow: "team_pulse", daysBack: 7 });

    expect(outcome.sources[0].sourceCount).toBe(5);
  });
});
