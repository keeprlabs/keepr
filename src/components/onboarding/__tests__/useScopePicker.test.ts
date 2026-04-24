// Tests for useScopePicker — the shared brain of the inline scope picker.
// Maps 1:1 to the test matrix in tasks/onboarding-scope-picker.md. Two
// regression tests (#8, #13) are load-bearing and must never be deleted:
// - #8 protects users from silent selection wipes on re-test
// - #13 protects the race between smart-defaults load and Continue click

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../../lib/types";
import { DEFAULT_CONFIG } from "../../../lib/types";

// ---- Mocks ---------------------------------------------------------------

const listPublicChannels = vi.fn();
const listUserRepos = vi.fn();
const listProjects = vi.fn();
const listTeams = vi.fn();

vi.mock("../../../services/slack", () => ({
  listPublicChannels: (...args: unknown[]) => listPublicChannels(...args),
}));
vi.mock("../../../services/github", () => ({
  listUserRepos: (...args: unknown[]) => listUserRepos(...args),
}));
vi.mock("../../../services/jira", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
}));
vi.mock("../../../services/linear", () => ({
  listTeams: (...args: unknown[]) => listTeams(...args),
}));

// In-memory fake config mirroring the setConfig/getConfig interface.
let fakeConfig: AppConfig;
const setConfigSpy = vi.fn();

vi.mock("../../../services/db", () => ({
  getConfig: vi.fn(async () => fakeConfig),
  setConfig: vi.fn(async (partial: Partial<AppConfig>) => {
    setConfigSpy(partial);
    fakeConfig = { ...fakeConfig, ...partial };
  }),
}));

// Pull the hook AFTER the mocks are registered.
import { useScopePicker } from "../useScopePicker";

// ---- Helpers -------------------------------------------------------------

function makeSlack(id: string, name: string, num_members = 10) {
  return { id, name, num_members };
}

beforeEach(() => {
  fakeConfig = { ...DEFAULT_CONFIG };
  setConfigSpy.mockClear();
  listPublicChannels.mockReset();
  listUserRepos.mockReset();
  listProjects.mockReset();
  listTeams.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountSlack() {
  const hook = renderHook(() => useScopePicker("slack"));
  // Flush the mount-effect microtasks. The hook fires reload() synchronously
  // from useEffect but awaits the fetcher + persistSelection.
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  return hook;
}

// ---- #1 Load success ------------------------------------------------------

describe("useScopePicker", () => {
  it("#1 load() success — populates items, pre-selects top 5 smart defaults, flushes setConfig synchronously", async () => {
    const channels = [
      makeSlack("C1", "eng-platform", 100),
      makeSlack("C2", "eng-frontend", 90),
      makeSlack("C3", "design-crit", 80),
      makeSlack("C4", "product-roadmap", 70),
      makeSlack("C5", "incidents", 60),
      makeSlack("C6", "dx", 50),
      makeSlack("C7", "random", 5000), // excluded
      makeSlack("C8", "general", 5000), // excluded
    ];
    listPublicChannels.mockResolvedValue(channels);

    const { result } = await mountSlack();

    expect(result.current.state.kind).toBe("loaded");
    expect(result.current.items).toHaveLength(8);
    expect(result.current.selected.size).toBe(5);
    // Verify exclusion of generic channels
    expect(result.current.selected.has("C7")).toBe(false);
    expect(result.current.selected.has("C8")).toBe(false);
    // Verify top-5 by num_members
    expect(result.current.selected.has("C1")).toBe(true);
    expect(result.current.selected.has("C5")).toBe(true);

    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    const persisted = setConfigSpy.mock.calls[0][0] as Partial<AppConfig>;
    expect(persisted.selected_slack_channels).toHaveLength(5);
  });

  // ---- #2 Load empty ------------------------------------------------------

  it("#2 load() empty — transitions to empty, no setConfig, no selection", async () => {
    listPublicChannels.mockResolvedValue([]);

    const { result } = await mountSlack();

    expect(result.current.state.kind).toBe("empty");
    expect(result.current.items).toHaveLength(0);
    expect(result.current.selected.size).toBe(0);
    expect(setConfigSpy).not.toHaveBeenCalled();
  });

  // ---- #3 Missing-scope error --------------------------------------------

  it("#3 load() missing-scope error — transitions to error with isMissingScope=true", async () => {
    listPublicChannels.mockRejectedValue(
      new Error("Slack conversations.list: missing_scope (channels:read)")
    );

    const { result } = await mountSlack();

    expect(result.current.state.kind).toBe("error");
    if (result.current.state.kind === "error") {
      expect(result.current.state.isMissingScope).toBe(true);
      expect(result.current.state.message).toMatch(/channels:read/);
    }
  });

  // ---- #4 Network error ---------------------------------------------------

  it("#4 load() network error — transitions to error with isMissingScope=false", async () => {
    listPublicChannels.mockRejectedValue(new Error("network offline"));

    const { result } = await mountSlack();

    expect(result.current.state.kind).toBe("error");
    if (result.current.state.kind === "error") {
      expect(result.current.state.isMissingScope).toBe(false);
      expect(result.current.state.message).toBe("network offline");
    }
  });

  // ---- #5 Toggle add ------------------------------------------------------

  it("#5 toggle() add — item appears in selected, setConfig persists the new set", async () => {
    const channels = [
      makeSlack("C1", "a", 100),
      makeSlack("C2", "b", 90),
      makeSlack("C3", "c", 80),
      makeSlack("C4", "d", 70),
      makeSlack("C5", "e", 60),
      makeSlack("C6", "f", 50),
    ];
    listPublicChannels.mockResolvedValue(channels);

    const { result } = await mountSlack();
    expect(result.current.selected.has("C6")).toBe(false);
    setConfigSpy.mockClear();

    await act(async () => {
      await result.current.toggle("C6");
    });

    expect(result.current.selected.has("C6")).toBe(true);
    expect(setConfigSpy).toHaveBeenCalledTimes(1);
    const persisted = setConfigSpy.mock.calls[0][0] as Partial<AppConfig>;
    expect(persisted.selected_slack_channels).toHaveLength(6);
  });

  // ---- #6 Toggle remove + userEdited flip ---------------------------------

  it("#6 toggle() remove — item leaves selected, state.userEdited becomes true", async () => {
    const channels = [
      makeSlack("C1", "a", 100),
      makeSlack("C2", "b", 90),
      makeSlack("C3", "c", 80),
      makeSlack("C4", "d", 70),
      makeSlack("C5", "e", 60),
    ];
    listPublicChannels.mockResolvedValue(channels);

    const { result } = await mountSlack();
    expect(result.current.state.kind).toBe("loaded");
    if (result.current.state.kind === "loaded") {
      expect(result.current.state.userEdited).toBe(false);
    }
    expect(result.current.selected.has("C1")).toBe(true);

    await act(async () => {
      await result.current.toggle("C1");
    });

    expect(result.current.selected.has("C1")).toBe(false);
    expect(result.current.state.kind).toBe("loaded");
    if (result.current.state.kind === "loaded") {
      expect(result.current.state.userEdited).toBe(true);
    }
  });

  // ---- #7 reTest identical list ------------------------------------------

  it("#7 reTest() identical list — selection unchanged, no staleItems", async () => {
    const channels = [
      makeSlack("C1", "a", 100),
      makeSlack("C2", "b", 90),
      makeSlack("C3", "c", 80),
      makeSlack("C4", "d", 70),
      makeSlack("C5", "e", 60),
    ];
    listPublicChannels.mockResolvedValue(channels);

    const { result } = await mountSlack();
    const before = new Set(result.current.selected);

    await act(async () => {
      await result.current.reTest();
    });

    expect(result.current.staleItems).toHaveLength(0);
    expect(new Set(result.current.selected)).toEqual(before);
  });

  // ---- #8 reTest vanished items — REGRESSION -----------------------------

  it("#8 REGRESSION reTest() with vanished items — surviving picks stay selected, vanished surface in staleItems, no silent wipe", async () => {
    const initial = [
      makeSlack("C1", "a", 100),
      makeSlack("C2", "b", 90),
      makeSlack("C3", "c", 80),
      makeSlack("C4", "d", 70),
      makeSlack("C5", "e", 60),
    ];
    listPublicChannels.mockResolvedValue(initial);
    const { result } = await mountSlack();
    expect(result.current.selected.size).toBe(5);

    // C4 and C5 vanish on the next fetch (e.g., archived or scope changed).
    listPublicChannels.mockResolvedValue([
      makeSlack("C1", "a", 100),
      makeSlack("C2", "b", 90),
      makeSlack("C3", "c", 80),
    ]);

    await act(async () => {
      await result.current.reTest();
    });

    // Surviving picks still in selection.
    expect(result.current.selected.has("C1")).toBe(true);
    expect(result.current.selected.has("C2")).toBe(true);
    expect(result.current.selected.has("C3")).toBe(true);
    // Vanished picks NOT silently wiped — they surface in staleItems so the
    // user sees the "Removed: #d" inline warning.
    expect(result.current.staleItems.map((s) => s.id).sort()).toEqual([
      "C4",
      "C5",
    ]);
    expect(result.current.selected.size).toBe(3);
  });

  // ---- #9 reTest workspace mismatch --------------------------------------

  it("#9 reTest() workspace mismatch — all prior selections in staleItems, fresh list has none of them", async () => {
    const initial = [
      makeSlack("C1", "a", 100),
      makeSlack("C2", "b", 90),
      makeSlack("C3", "c", 80),
      makeSlack("C4", "d", 70),
      makeSlack("C5", "e", 60),
    ];
    listPublicChannels.mockResolvedValue(initial);
    const { result } = await mountSlack();
    const originalIds = [...result.current.selected].sort();

    // Simulate the user pasting a token from a completely different workspace.
    listPublicChannels.mockResolvedValue([
      makeSlack("D1", "other-a", 100),
      makeSlack("D2", "other-b", 90),
    ]);

    await act(async () => {
      await result.current.reTest();
    });

    expect(result.current.staleItems.map((s) => s.id).sort()).toEqual(
      originalIds
    );
    expect(result.current.selected.size).toBe(0);
  });

  // ---- #10 setFilter narrows, no API call --------------------------------

  it("#10 setFilter('eng') narrows visibleItems without firing a fetch", async () => {
    const channels = [
      makeSlack("C1", "eng-platform", 100),
      makeSlack("C2", "eng-frontend", 90),
      makeSlack("C3", "design-crit", 80),
      makeSlack("C4", "product-roadmap", 70),
      makeSlack("C5", "incidents", 60),
      makeSlack("C6", "dx", 50),
    ];
    listPublicChannels.mockResolvedValue(channels);
    const { result } = await mountSlack();
    expect(listPublicChannels).toHaveBeenCalledTimes(1);

    act(() => result.current.setFilter("eng"));
    // Flush the debounce timer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    const visibleLabels = result.current.visibleItems.map((i) => i.label);
    expect(visibleLabels).toEqual(["#eng-platform", "#eng-frontend"]);
    // No additional fetch from filtering.
    expect(listPublicChannels).toHaveBeenCalledTimes(1);
  });

  // ---- #11 Clearing filter restores top-15 + selected --------------------

  it("#11 setFilter('') — visibleItems restored to top-15 + selected pinned", async () => {
    const channels = Array.from({ length: 20 }, (_, i) =>
      makeSlack(`C${i}`, `ch-${i}`, 1000 - i)
    );
    listPublicChannels.mockResolvedValue(channels);
    const { result } = await mountSlack();

    act(() => result.current.setFilter("ch-0"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(result.current.visibleItems.length).toBeLessThan(20);

    act(() => result.current.setFilter(""));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    // Top 15 by rank, plus any pre-selected items outside top 15 (smart
    // defaults are all within top 15 for this dataset so just 15).
    expect(result.current.visibleItems.length).toBe(15);
  });

  // ---- #12 expandAll renders full list alphabetically --------------------

  it("#12 expandAll() — visibleItems = full list, sorted alphabetically", async () => {
    const channels = [
      makeSlack("C1", "zebra", 100),
      makeSlack("C2", "alpha", 90),
      makeSlack("C3", "mango", 80),
      makeSlack("C4", "delta", 70),
      makeSlack("C5", "beta", 60),
      makeSlack("C6", "omega", 50),
    ];
    listPublicChannels.mockResolvedValue(channels);
    const { result } = await mountSlack();

    act(() => result.current.expandAll());

    const labels = result.current.visibleItems.map((i) => i.label);
    expect(labels).toEqual([
      "#alpha",
      "#beta",
      "#delta",
      "#mango",
      "#omega",
      "#zebra",
    ]);
  });

  // ---- #13 Race-fix — Continue clicked immediately after load — REGRESSION -

  it("#13 REGRESSION race-fix — getConfig() reports all 5 defaults immediately after load, no toggle needed", async () => {
    const channels = [
      makeSlack("C1", "a", 100),
      makeSlack("C2", "b", 90),
      makeSlack("C3", "c", 80),
      makeSlack("C4", "d", 70),
      makeSlack("C5", "e", 60),
      makeSlack("C6", "f", 50),
    ];
    listPublicChannels.mockResolvedValue(channels);

    await mountSlack();

    // The moment state.kind === "loaded", the user may click Continue and
    // pipeline.ts reads getConfig(). So the 5 smart defaults MUST already
    // be in fakeConfig with zero toggles.
    expect(fakeConfig.selected_slack_channels).toHaveLength(5);
    expect(fakeConfig.selected_slack_channels.map((c) => c.id).sort()).toEqual([
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
    ]);
  });

  // ---- #14 Slack identity uses channel.id ---------------------------------

  it("#14 Slack identity uses channel.id — same-name channels with different IDs are distinct", async () => {
    const channels = [
      makeSlack("C1", "eng", 100),
      makeSlack("C2", "eng", 90), // same name, different id (edge case)
      makeSlack("C3", "design", 80),
    ];
    listPublicChannels.mockResolvedValue(channels);
    const { result } = await mountSlack();

    expect(result.current.items.map((i) => i.id).sort()).toEqual([
      "C1",
      "C2",
      "C3",
    ]);
    expect(result.current.selected.has("C1")).toBe(true);
    expect(result.current.selected.has("C2")).toBe(true);
  });

  // ---- #15 GitHub identity uses full_name --------------------------------

  it("#15 GitHub identity uses full_name — repo rename surfaces as stale on re-test", async () => {
    const before = [
      { name: "keepr", full_name: "keeprlabs/keepr", owner: { login: "keeprlabs" } },
      { name: "cli", full_name: "keeprlabs/cli", owner: { login: "keeprlabs" } },
    ];
    listUserRepos.mockResolvedValue(before);

    const hook = renderHook(() => useScopePicker("github"));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    const { result } = hook;
    expect(result.current.selected.has("keeprlabs/keepr")).toBe(true);

    // Repo rename: keeprlabs/cli → keeprlabs/keepr-cli.
    listUserRepos.mockResolvedValue([
      { name: "keepr", full_name: "keeprlabs/keepr", owner: { login: "keeprlabs" } },
      {
        name: "keepr-cli",
        full_name: "keeprlabs/keepr-cli",
        owner: { login: "keeprlabs" },
      },
    ]);

    await act(async () => {
      await result.current.reTest();
    });

    // keeprlabs/cli should appear as stale (acceptable false-positive per plan).
    expect(result.current.staleItems.map((s) => s.id)).toContain(
      "keeprlabs/cli"
    );
  });

  // ---- #16 Toggle persistence failure — REGRESSION -----------------------

  it("#16 REGRESSION toggle() failure — UI state reverts, inline error surfaces", async () => {
    const channels = [
      makeSlack("C1", "a", 100),
      makeSlack("C2", "b", 90),
      makeSlack("C3", "c", 80),
      makeSlack("C4", "d", 70),
      makeSlack("C5", "e", 60),
      makeSlack("C6", "f", 50),
    ];
    listPublicChannels.mockResolvedValue(channels);
    const { result } = await mountSlack();
    expect(result.current.selected.has("C6")).toBe(false);

    // Now make the next setConfig call fail (simulating disk-full / DB locked).
    const db = await import("../../../services/db");
    const original = db.setConfig;
    (db as any).setConfig = vi.fn(async () => {
      throw new Error("database is locked");
    });

    await act(async () => {
      await result.current.toggle("C6");
    });

    expect(result.current.selected.has("C6")).toBe(false); // reverted
    expect(result.current.toggleError).toMatch(/Couldn't save/);

    // Restore — other tests share the module.
    (db as any).setConfig = original;
  });
});
