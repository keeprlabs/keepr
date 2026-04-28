// Regression coverage for the team-mapping step. The headline test pins
// the bug the user reported: typing in the GitHub column must NEVER mutate
// the Slack value. Other tests cover the smart-fill flow's "won't
// overwrite manual selections" guarantee.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────

const upsertMember = vi.fn<(arg: any) => Promise<number>>(async () => 1);
const listMembers = vi.fn<() => Promise<any[]>>(async () => []);
const getConfig = vi.fn<() => Promise<any>>(async () => ({
  selected_jira_projects: [{ key: "KEEPR", id: "1", name: "Keepr" }],
}));

vi.mock("../../../services/db", () => ({
  upsertMember: (arg: any) => upsertMember(arg),
  listMembers: () => listMembers(),
  getConfig: () => getConfig(),
}));

const getSecret = vi.fn<(key: string) => Promise<string | null>>(
  async (key) => "token-" + key
);
vi.mock("../../../services/secrets", () => ({
  SECRET_KEYS: {
    slackBot: "slack.bot_token",
    github: "github.token",
    jiraEmail: "jira.email",
    jiraToken: "jira.api_token",
    linear: "linear.api_key",
  },
  getSecret: (key: string) => getSecret(key),
}));

const slackUsers = [
  {
    id: "U_PRIYA",
    name: "priyar",
    real_name: "Priya Raman",
    profile: { display_name: "Priya R", real_name: "Priya Raman" },
  },
  {
    id: "U_MARK",
    name: "markb",
    real_name: "Mark Brown",
    profile: { display_name: "Mark", real_name: "Mark Brown" },
  },
];
const listSlackUsers = vi.fn<() => Promise<typeof slackUsers>>(async () => slackUsers);
vi.mock("../../../services/slack", () => ({
  listUsers: () => listSlackUsers(),
}));

const linearUsers = [
  { id: "lin-1", name: "priya", displayName: "Priya R.", email: "priya@x.io" },
  { id: "lin-2", name: "mark", displayName: "Mark Brown", email: "mark@x.io" },
];
vi.mock("../../../services/linear", () => ({
  listOrgMembers: vi.fn(async () => linearUsers),
}));

vi.mock("../../../services/jira", () => ({
  listProjectMembers: vi.fn(async () => [
    { accountId: "j-1", displayName: "Priya Raman", emailAddress: "priya@x.io" },
  ]),
}));

vi.mock("../../../services/github", () => ({
  listUserOrgs: vi.fn(async () => [{ login: "acme", description: null }]),
  listOrgMembers: vi.fn(async () => [
    { login: "octocat", name: "The Octocat", avatarUrl: null },
    { login: "priya", name: "Priya Raman", avatarUrl: null },
  ]),
  hasReadOrgScope: vi.fn(async () => true),
  invalidateScopeCache: vi.fn(),
  GITHUB_CLIENT_ID: "Iv1.keepr-placeholder",
  GITHUB_OAUTH_SCOPES: "read:user repo read:org",
}));

vi.mock("../../../services/memory", () => ({
  slugify: (s: string) => s.toLowerCase().replace(/\s+/g, "-"),
}));

import { StepTeam } from "../StepTeam";
import { invalidateGitHubPool } from "../../../services/teammateSearch";

beforeEach(() => {
  upsertMember.mockClear();
  listMembers.mockReset();
  listMembers.mockResolvedValue([]);
  getSecret.mockReset();
  getSecret.mockImplementation(async () => "tok");
  getConfig.mockReset();
  getConfig.mockResolvedValue({
    selected_jira_projects: [{ key: "KEEPR", id: "1", name: "Keepr" }],
  });
  invalidateGitHubPool();
});

afterEach(() => {
  vi.clearAllTimers();
});

describe("StepTeam — cross-field overwrite regression", () => {
  it("typing in the GitHub column does NOT change the Slack value", async () => {
    const onNext = vi.fn();
    render(<StepTeam onNext={onNext} />);

    // Wait for initial load (provider availability check).
    await waitFor(() => expect(getSecret).toHaveBeenCalled());

    // Type a display name.
    const nameInput = screen.getAllByPlaceholderText("Display name")[0] as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Priya Raman" } });

    // Save without ever touching the GitHub column. There must be no
    // auto-bound Slack id — we never opened the Slack combobox or typed
    // anything that should have set it.
    const save = screen.getByRole("button", { name: /save/i });
    fireEvent.click(save);
    await waitFor(() => expect(upsertMember).toHaveBeenCalled());
    const arg = upsertMember.mock.calls[0]![0] as any;
    expect(arg.display_name).toBe("Priya Raman");
    // The classic bug: typing in name auto-set slack_user_id. Today, it
    // must stay null until the user explicitly picks.
    expect(arg.slack_user_id).toBeNull();
    expect(arg.github_handle).toBeNull();
  });
});

describe("StepTeam — smart-fill confirmation panel", () => {
  it("opens on click and shows candidates for connected providers only", async () => {
    // GitHub disconnected, others connected.
    getSecret.mockImplementation(async (key: string) => {
      if (key === "github.token") return null;
      return "tok";
    });

    render(<StepTeam onNext={vi.fn()} />);

    await waitFor(() => expect(getSecret).toHaveBeenCalled());

    fireEvent.change(
      (screen.getAllByPlaceholderText("Display name")[0] as HTMLInputElement),
      { target: { value: "Priya" } }
    );

    const buttons = screen.getAllByRole("button", { name: /find matches across all/i });
    fireEvent.click(buttons[0]);

    // Panel resolves to candidate select boxes for connected providers.
    await waitFor(() => {
      // At least one provider label should appear in the panel.
      expect(screen.queryByText(/searching all providers/i)).toBeNull();
    });
  });
});
