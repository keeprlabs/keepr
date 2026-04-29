// UpdateBanner tests — view layer only. Logic lives in services/updater.ts
// (covered separately). These tests assert the banner subscribes correctly,
// renders the right message per state, and routes the Restart click.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkForUpdateMock = vi.fn<() => Promise<any>>(async () => {});
const relaunchMock = vi.fn<() => Promise<void>>(async () => {});
let currentState: any = { kind: "idle" };
const subscribers: Array<(s: any) => void> = [];

function setStubState(next: any) {
  currentState = next;
  for (const s of subscribers) s(next);
}

vi.mock("../../services/updater", () => ({
  getState: () => currentState,
  subscribe: (fn: (s: any) => void) => {
    subscribers.push(fn);
    fn(currentState);
    return () => {
      const i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  },
  checkForUpdate: () => checkForUpdateMock(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: () => relaunchMock(),
}));

import { UpdateBanner } from "../UpdateBanner";

beforeEach(() => {
  checkForUpdateMock.mockReset();
  checkForUpdateMock.mockResolvedValue(undefined);
  relaunchMock.mockReset();
  relaunchMock.mockResolvedValue(undefined);
  subscribers.length = 0;
  currentState = { kind: "idle" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UpdateBanner", () => {
  it("renders nothing in idle state", () => {
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing in current state", () => {
    currentState = { kind: "current" };
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the Restart button when state is ready", () => {
    currentState = { kind: "ready", version: "0.2.6", update: { version: "0.2.6" } };
    render(<UpdateBanner />);
    expect(screen.getByText(/ready to install/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart to install/i })).toBeInTheDocument();
  });

  it("renders the brew-upgrade copy when state is fallback", () => {
    currentState = { kind: "fallback", version: "0.2.6" };
    render(<UpdateBanner />);
    expect(screen.getByText(/brew upgrade --cask keepr/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /restart to install/i })).toBeNull();
  });

  it("invokes relaunch() when Restart is clicked", async () => {
    currentState = { kind: "ready", version: "0.2.6", update: { version: "0.2.6" } };
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /restart to install/i }));
    // Allow microtasks to flush
    await Promise.resolve();
    expect(relaunchMock).toHaveBeenCalled();
  });

  it("dismiss hides the banner for the session", () => {
    currentState = { kind: "ready", version: "0.2.6", update: { version: "0.2.6" } };
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/ready to install/i)).toBeNull();
  });

  it("calls checkForUpdate() on mount", () => {
    render(<UpdateBanner />);
    expect(checkForUpdateMock).toHaveBeenCalled();
  });

  it("re-renders when the singleton transitions to ready", () => {
    const { container } = render(<UpdateBanner />);
    expect(container.firstChild).toBeNull();
    act(() => {
      setStubState({ kind: "ready", version: "0.2.6", update: { version: "0.2.6" } });
    });
    expect(screen.getByText(/ready to install/i)).toBeInTheDocument();
  });
});
