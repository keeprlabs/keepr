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
const listUserProjects = vi.fn();

vi.mock("../../services/slack", () => ({
  listPublicChannels: (...a: unknown[]) => listPublicChannels(...a),
}));

vi.mock("../../services/github", () => ({
  listUserRepos: (...a: unknown[]) => listUserRepos(...a),
  hasReadOrgScope: vi.fn(async () => true),
  invalidateScopeCache: vi.fn(),
  listUserOrgs: vi.fn(async () => []),
  listOrgMembers: vi.fn(async () => []),
}));

vi.mock("../../services/gitlab", () => ({
  listUserProjects: (...a: unknown[]) => listUserProjects(...a),
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
    gitlab: "gitlab",
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
    k === "slack_bot" || k === "github" || k === "gitlab" ? "dummy-token" : ""
  ),
  setSecret: vi.fn(async () => {}),
}));

const llmMocks = vi.hoisted(() => ({
  probeCodex: vi.fn(async () => ({ ok: true } as { ok: true })),
  probeClaudeCode: vi.fn(async () => ({ ok: true } as { ok: true })),
  invalidateCodexProbe: vi.fn(),
  invalidateClaudeProbe: vi.fn(),
}));

vi.mock("../../services/llm", () => {
  const provider = (id: string, category: string, extras: Record<string, unknown> = {}) => ({
    id,
    category,
    label: id,
    keyUrl: id === "anthropic" ? "https://platform.claude.com/settings/keys" : "",
    defaultSynthesisModel: "x",
    defaultClassifierModel: "y",
    ...extras,
  });
  const PROVIDERS: Record<string, any> = {
    anthropic: provider("anthropic", "hosted"),
    openai: provider("openai", "hosted"),
    openrouter: provider("openrouter", "hosted"),
    custom: provider("custom", "hosted"),
    "claude-code": provider("claude-code", "cli", {
      cli: { installCmd: "npm install -g @anthropic-ai/claude-code", loginCmd: "claude login" },
    }),
    codex: provider("codex", "cli", {
      cli: { installCmd: "npm install -g @openai/codex", loginCmd: "codex login" },
    }),
  };
  return {
    getProvider: vi.fn((id: string) => PROVIDERS[id] || PROVIDERS.anthropic),
    setCustomConfig: vi.fn(),
    providersByCategory: () => ({
      hosted: [PROVIDERS.anthropic, PROVIDERS.openai, PROVIDERS.openrouter, PROVIDERS.custom],
      cli: [PROVIDERS["claude-code"], PROVIDERS.codex],
      self_hosted: [],
    }),
    probeCodex: llmMocks.probeCodex,
    probeClaudeCode: llmMocks.probeClaudeCode,
    invalidateCodexProbe: llmMocks.invalidateCodexProbe,
    invalidateClaudeProbe: llmMocks.invalidateClaudeProbe,
    friendlyProviderError: (e: any) => e?.message || "Test call failed.",
  };
});

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

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => null),
}));

vi.mock("../../components/primitives/SourceBadge", () => ({
  GitHubIcon: () => null,
  GitLabIcon: () => null,
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
  listUserProjects.mockReset();
  listPublicChannels.mockResolvedValue([]);
  listUserRepos.mockResolvedValue([]);
  listUserProjects.mockResolvedValue([]);
  llmMocks.probeCodex.mockClear();
  llmMocks.probeClaudeCode.mockClear();
  llmMocks.probeCodex.mockResolvedValue({ ok: true } as { ok: true });
  llmMocks.probeClaudeCode.mockResolvedValue({ ok: true } as { ok: true });
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
    await waitFor(() => {
      expect(listUserProjects).toHaveBeenCalledTimes(1);
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

  it("#3 REGRESSION mount with pre-selected GitLab projects — listUserProjects NOT called", async () => {
    fakeConfig = {
      ...DEFAULT_CONFIG,
      selected_gitlab_projects: [
        { id: 1, path_with_namespace: "acme/platform" },
      ],
    };

    await act(async () => {
      render(<Settings />);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(listUserProjects).not.toHaveBeenCalled();
  });
});

describe("Settings — CLI provider lazy probe [lane E billing-blast-radius]", () => {
  // The whole reason for the lazy probe: a user who opens Settings to fix
  // their Slack token must NOT trigger a silent OpenAI/Anthropic billing
  // call just because the LLM panel is on the same screen. Probes ONLY fire
  // when the active provider is a CLI tool.

  it("[CRITICAL] mount with anthropic active — NO codex or claude-code probe fires", async () => {
    // Anthropic uses an API key, so neither CLI probe should run. This is
    // the regression test for the billing-blast-radius decision.
    fakeConfig = { ...DEFAULT_CONFIG, llm_provider: "anthropic" };
    await act(async () => {
      render(<Settings />);
    });
    // Drain any pending effects.
    await waitFor(() => expect(listPublicChannels).toHaveBeenCalled());
    expect(llmMocks.probeCodex).not.toHaveBeenCalled();
    expect(llmMocks.probeClaudeCode).not.toHaveBeenCalled();
  });

  it("mount with codex active — probeCodex fires once, probeClaudeCode does NOT", async () => {
    fakeConfig = { ...DEFAULT_CONFIG, llm_provider: "codex" };
    await act(async () => {
      render(<Settings />);
    });
    await waitFor(() => expect(llmMocks.probeCodex).toHaveBeenCalledTimes(1));
    expect(llmMocks.probeClaudeCode).not.toHaveBeenCalled();
  });

  it("mount with claude-code active — probeClaudeCode fires once, probeCodex does NOT", async () => {
    fakeConfig = { ...DEFAULT_CONFIG, llm_provider: "claude-code" };
    await act(async () => {
      render(<Settings />);
    });
    await waitFor(() => expect(llmMocks.probeClaudeCode).toHaveBeenCalledTimes(1));
    expect(llmMocks.probeCodex).not.toHaveBeenCalled();
  });

  it("the Local CLI category divider renders inside the Model panel", async () => {
    fakeConfig = { ...DEFAULT_CONFIG, llm_provider: "anthropic" };
    let utils: ReturnType<typeof render> | null = null;
    await act(async () => {
      utils = render(<Settings />);
    });
    await waitFor(() => expect(utils!.getByText("Local CLI")).toBeDefined());
    // self_hosted has no providers in v1, so its divider should be absent.
    expect(utils!.queryByText("Self-hosted")).toBeNull();
  });
});
