// Regression tests for the two error paths at pipeline.ts:513-534.
// Test #1 locks in the new "Open Settings (⌘,)" copy landed in Lane B.
// Test #2 makes sure the existing "fetched … but got zero items" path still
// triggers when the user HAS configured sources but the fetch came back empty.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../lib/types";
import { DEFAULT_CONFIG } from "../../lib/types";

// ---- Mocks ---------------------------------------------------------------

let fakeConfig: AppConfig;

vi.mock("../db", () => ({
  getConfig: vi.fn(async () => fakeConfig),
  listMembers: vi.fn(async () => []),
  createSession: vi.fn(async () => 1),
  setSessionStatus: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  updateSession: vi.fn(async () => {}),
  insertEvidence: vi.fn(async () => 1),
  insertPersonFacts: vi.fn(async () => {}),
  upsertIntegration: vi.fn(async () => {}),
}));

const fetchRepoActivity = vi.fn();
vi.mock("../github", () => ({
  fetchRepoActivity: (...a: unknown[]) => fetchRepoActivity(...a),
}));

vi.mock("../slack", () => ({
  authTest: vi.fn(async () => ({ team: "t", user: "u", team_id: "T1" })),
  fetchChannelHistory: vi.fn(async () => []),
}));

vi.mock("../jira", () => ({
  fetchProjectActivity: vi.fn(async () => []),
}));

vi.mock("../linear", () => ({
  fetchTeamActivity: vi.fn(async () => []),
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
});

// ---- Tests ---------------------------------------------------------------

describe("runWorkflow — source-validation errors", () => {
  it("#1 REGRESSION no sources configured — throws with Open Settings copy", async () => {
    // Default config has all empty selected_* arrays.
    await expect(
      runWorkflow({ workflow: "team_pulse", daysBack: 7 })
    ).rejects.toThrow(/Open Settings and connect at least one/);
  });

  it("#2 some sources configured but zero items returned — existing detailed error still fires", async () => {
    fakeConfig = {
      ...DEFAULT_CONFIG,
      selected_github_repos: [{ owner: "keeprlabs", repo: "keepr" }],
    };
    fetchRepoActivity.mockResolvedValue([]);

    await expect(
      runWorkflow({ workflow: "team_pulse", daysBack: 7 })
    ).rejects.toThrow(/Fetched from .*repo.*got zero items/);
  });
});
