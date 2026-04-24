// Regression tests for the Lane C auto-load gating added at
// Settings.tsx:71-94. Goal: users with already-picked channels don't pay a
// 200-item fetch tax on every Settings visit, while first-time users see
// chips populate automatically.

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../lib/types";
import { DEFAULT_CONFIG } from "../../lib/types";

// ---- Mocks ---------------------------------------------------------------

const listPublicChannels = vi.fn();
const listUserRepos = vi.fn();

vi.mock("../../services/slack", () => ({
  listPublicChannels: (...a: unknown[]) => listPublicChannels(...a),
}));

vi.mock("../../services/github", () => ({
  listUserRepos: (...a: unknown[]) => listUserRepos(...a),
}));

vi.mock("../../services/jira", () => ({}));
vi.mock("../../services/linear", () => ({}));

let fakeConfig: AppConfig;

vi.mock("../../services/db", () => ({
  getConfig: vi.fn(async () => fakeConfig),
  setConfig: vi.fn(async () => {}),
  listMembers: vi.fn(async () => []),
  upsertIntegration: vi.fn(async () => {}),
  upsertMember: vi.fn(async () => {}),
  deleteMember: vi.fn(async () => {}),
}));

vi.mock("../../services/secrets", () => ({
  SECRET_KEYS: {
    slackBot: "slack_bot",
    github: "github",
    jiraEmail: "jira_email",
    jiraToken: "jira_token",
    linear: "linear",
    anthropic: "anthropic",
    openai: "openai",
    openrouter: "openrouter",
    custom: "custom",
  },
  // Provide non-empty tokens so the auto-load gate passes the token check.
  getSecret: vi.fn(async (k: string) =>
    k === "slack_bot" || k === "github" ? "dummy-token" : ""
  ),
  setSecret: vi.fn(async () => {}),
}));

vi.mock("../../services/llm", () => ({
  getProvider: vi.fn(() => ({
    id: "anthropic",
    label: "Anthropic",
    defaultSynthesisModel: "x",
    defaultClassifierModel: "y",
    requiresKey: true,
    keyPlaceholder: "",
    keyHelp: "",
  })),
  setCustomConfig: vi.fn(),
}));

vi.mock("../../services/fsio", () => ({
  defaultMemoryDir: vi.fn(async () => "/tmp/mem"),
}));

vi.mock("../../services/memory", () => ({
  slugify: (s: string) => s.toLowerCase(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

vi.mock("../../components/primitives/SourceBadge", () => ({
  GitHubIcon: () => null,
  SlackIcon: () => null,
  JiraIcon: () => null,
  LinearIcon: () => null,
}));

import { Settings } from "../Settings";

// ---- Helpers -------------------------------------------------------------

beforeEach(() => {
  fakeConfig = { ...DEFAULT_CONFIG };
  listPublicChannels.mockReset();
  listUserRepos.mockReset();
  listPublicChannels.mockResolvedValue([]);
  listUserRepos.mockResolvedValue([]);
});

// ---- Tests ---------------------------------------------------------------

describe("Settings — auto-load gating", () => {
  it("#1 mount with empty selections — listPublicChannels called once on mount", async () => {
    await act(async () => {
      render(<Settings />);
    });

    await waitFor(() => {
      expect(listPublicChannels).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(listUserRepos).toHaveBeenCalledTimes(1);
    });
  });

  it("#2 REGRESSION mount with 5 pre-selected channels — listPublicChannels NOT called on mount; 'Load public channels' button stays the entry point", async () => {
    fakeConfig = {
      ...DEFAULT_CONFIG,
      selected_slack_channels: [
        { id: "C1", name: "a" },
        { id: "C2", name: "b" },
        { id: "C3", name: "c" },
        { id: "C4", name: "d" },
        { id: "C5", name: "e" },
      ],
      selected_github_repos: [{ owner: "keeprlabs", repo: "keepr" }],
    };

    let utils: ReturnType<typeof render> | null = null;
    await act(async () => {
      utils = render(<Settings />);
    });

    // Drain any stray effects. Auto-load gate should NOT have fired.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(listPublicChannels).not.toHaveBeenCalled();
    expect(listUserRepos).not.toHaveBeenCalled();

    // Power-user button labels stay as the original "Load" copy until the
    // user clicks (the Reload relabel triggers AFTER a successful fetch).
    await utils!.findByText(/Load public channels/);
    await utils!.findByText(/Load my repos/);
  });
});
