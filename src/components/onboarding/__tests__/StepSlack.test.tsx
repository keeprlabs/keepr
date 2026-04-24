// Render-level integration tests for StepSlack. Covers the four regressions
// in the plan's test matrix: pre-auth hides scope, post-auth shows it and
// focuses the filter, Continue gates on selected >= 1, and Skip preserves
// any picks already made before the user bailed.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../../lib/types";
import { DEFAULT_CONFIG } from "../../../lib/types";

// ---- Mocks ---------------------------------------------------------------

const authTest = vi.fn();
const listPublicChannels = vi.fn();

vi.mock("../../../services/slack", () => ({
  authTest: (...args: unknown[]) => authTest(...args),
  listPublicChannels: (...args: unknown[]) => listPublicChannels(...args),
}));

vi.mock("../../../services/secrets", () => ({
  SECRET_KEYS: { slackBot: "slack_bot" },
  getSecret: vi.fn(async () => null),
  setSecret: vi.fn(async () => {}),
}));

let fakeConfig: AppConfig;
const setConfigSpy = vi.fn();
const upsertIntegration = vi.fn();

vi.mock("../../../services/db", () => ({
  getConfig: vi.fn(async () => fakeConfig),
  setConfig: vi.fn(async (partial: Partial<AppConfig>) => {
    setConfigSpy(partial);
    fakeConfig = { ...fakeConfig, ...partial };
  }),
  upsertIntegration: (...args: unknown[]) => upsertIntegration(...args),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(async () => {}),
}));

// navigator.clipboard — jsdom doesn't ship it by default.
Object.defineProperty(globalThis.navigator, "clipboard", {
  value: { writeText: vi.fn(async () => {}) },
  configurable: true,
});

import { StepSlack } from "../StepSlack";

// ---- Helpers -------------------------------------------------------------

beforeEach(() => {
  fakeConfig = { ...DEFAULT_CONFIG };
  setConfigSpy.mockClear();
  authTest.mockReset();
  listPublicChannels.mockReset();
  upsertIntegration.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderStep() {
  const onNext = vi.fn();
  const onSkip = vi.fn();
  const utils = render(<StepSlack onNext={onNext} onSkip={onSkip} />);
  return { onNext, onSkip, ...utils };
}

async function authSucceed(token = "xoxb-test") {
  authTest.mockResolvedValue({ team: "acme", user: "U1", team_id: "T1" });
  const input = screen.getByPlaceholderText("xoxb-…") as HTMLInputElement;
  fireEvent.change(input, { target: { value: token } });
  const testBtn = screen.getByRole("button", { name: /test & save/i });
  await act(async () => {
    fireEvent.click(testBtn);
  });
}

// ---- Tests ---------------------------------------------------------------

describe("StepSlack", () => {
  it("#1 pre-auth — scope section NOT in DOM", () => {
    renderStep();
    expect(screen.queryByText(/pick channels to read/i)).toBeNull();
    // Test & save is the only primary affordance (disabled until token typed).
    expect(
      screen.getByRole("button", { name: /test & save/i })
    ).toBeInTheDocument();
  });

  it("#1b pre-auth — step 05 /invite @Keepr instruction is present (regression)", () => {
    renderStep();
    // The /invite @Keepr instruction is load-bearing for the most common
    // cause of partial_failure (bot not in channel). Don't lose the copy.
    expect(screen.getByText(/\/invite @Keepr/)).toBeInTheDocument();
  });

  it("#2 post-auth — scope section appears and filter input receives focus", async () => {
    const channels = [
      { id: "C1", name: "a", num_members: 100 },
      { id: "C2", name: "b", num_members: 90 },
      { id: "C3", name: "c", num_members: 80 },
      { id: "C4", name: "d", num_members: 70 },
      { id: "C5", name: "e", num_members: 60 },
    ];
    listPublicChannels.mockResolvedValue(channels);
    renderStep();

    await act(async () => {
      await authSucceed();
    });

    // Section visible after auth.
    await screen.findByText(/pick channels to read/i);

    // Focus is scheduled on a 180ms timeout after the rise transition —
    // a short real-timer wait covers it without fighting fake timers.
    await waitFor(
      () => {
        const filter = screen.getByPlaceholderText(
          "Filter channels…"
        ) as HTMLInputElement;
        expect(document.activeElement).toBe(filter);
      },
      { timeout: 1000 }
    );
  });

  it("#3a Continue gating — disabled at 0 selections (empty workspace)", async () => {
    listPublicChannels.mockResolvedValue([]);
    renderStep();
    await act(async () => {
      await authSucceed();
    });

    await waitFor(() =>
      expect(screen.getByText(/pick channels to read/i)).toBeInTheDocument()
    );
    const cont = screen.getByRole("button", { name: /continue/i });
    expect(cont).toBeDisabled();
    expect(cont.getAttribute("title")).toMatch(/pick at least one channel/i);
  });

  it("#3b Continue gating — enabled at >= 1 selection (smart defaults populated)", async () => {
    listPublicChannels.mockResolvedValue([
      { id: "C1", name: "a", num_members: 100 },
      { id: "C2", name: "b", num_members: 90 },
      { id: "C3", name: "c", num_members: 80 },
      { id: "C4", name: "d", num_members: 70 },
      { id: "C5", name: "e", num_members: 60 },
    ]);
    renderStep();
    await act(async () => {
      await authSucceed();
    });

    await waitFor(() =>
      expect(screen.getByText(/pick channels to read/i)).toBeInTheDocument()
    );
    await waitFor(() => {
      const cont = screen.getByRole("button", { name: /continue/i });
      expect(cont).not.toBeDisabled();
    });
  });

  it("#4 Skip after picks — selections persist, onSkip fires (step advances)", async () => {
    const channels = [
      { id: "C1", name: "a", num_members: 100 },
      { id: "C2", name: "b", num_members: 90 },
      { id: "C3", name: "c", num_members: 80 },
      { id: "C4", name: "d", num_members: 70 },
      { id: "C5", name: "e", num_members: 60 },
    ];
    listPublicChannels.mockResolvedValue(channels);
    const { onSkip } = renderStep();
    await act(async () => {
      await authSucceed();
    });

    // Wait for smart-defaults flush — setConfig should have been called with
    // the five default channel ids.
    await waitFor(() => {
      const call = setConfigSpy.mock.calls.find(
        (c) => (c[0] as Partial<AppConfig>).selected_slack_channels
      );
      expect(call).toBeTruthy();
    });

    const flushedBeforeSkip = [...setConfigSpy.mock.calls];
    const skipBtn = screen.getByRole("button", { name: /skip for now/i });
    fireEvent.click(skipBtn);

    expect(onSkip).toHaveBeenCalledTimes(1);
    // Skip should NOT wipe — nothing additional written AFTER the click.
    expect(setConfigSpy.mock.calls).toEqual(flushedBeforeSkip);
    // Config still has the 5 defaults the user picked (implicitly).
    expect(fakeConfig.selected_slack_channels.length).toBe(5);
  });
});

