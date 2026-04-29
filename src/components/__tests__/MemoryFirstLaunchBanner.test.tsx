import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../lib/types";

const memoryStatusMock = vi.fn();
const getConfigMock = vi.fn();
const setConfigMock = vi.fn();

vi.mock("../../services/ctxStore", () => ({
  memoryStatus: (...a: unknown[]) => memoryStatusMock(...a),
  isReady: (s: { status: string }) => s.status === "ready",
}));

vi.mock("../../services/db", () => ({
  getConfig: (...a: unknown[]) => getConfigMock(...a),
  setConfig: (...a: unknown[]) => setConfigMock(...a),
}));

import { MemoryFirstLaunchBanner } from "../MemoryFirstLaunchBanner";

beforeEach(() => {
  memoryStatusMock.mockReset();
  getConfigMock.mockReset();
  setConfigMock.mockReset();
  setConfigMock.mockResolvedValue(undefined);
});

describe("MemoryFirstLaunchBanner", () => {
  it("renders nothing when memory_first_launch_seen is true", async () => {
    getConfigMock.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      memory_first_launch_seen: true,
    });
    const { container } = render(<MemoryFirstLaunchBanner />);
    // Wait for the effect to settle.
    await waitFor(() => expect(getConfigMock).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(memoryStatusMock).not.toHaveBeenCalled();
  });

  it("renders the banner when first-launch is unseen AND daemon is ready", async () => {
    getConfigMock.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      memory_first_launch_seen: false,
    });
    memoryStatusMock.mockResolvedValueOnce({
      status: "ready",
      http_port: 51234,
      wire_port: 51235,
    });
    render(<MemoryFirstLaunchBanner />);
    await waitFor(() =>
      expect(screen.getByText(/Memory layer is on/i)).toBeDefined()
    );
    expect(screen.getByText(/Got it/i)).toBeDefined();
    expect(screen.getByRole("region", { name: /Memory layer first-launch banner/i })).toBeDefined();
  });

  it("does NOT show when daemon is starting or offline (initial check)", async () => {
    getConfigMock.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      memory_first_launch_seen: false,
    });
    memoryStatusMock.mockResolvedValueOnce({ status: "starting" });
    const { container } = render(<MemoryFirstLaunchBanner />);
    // Allow the initial-status effect to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });

  it("clicking 'Got it' calls setConfig with memory_first_launch_seen=true", async () => {
    getConfigMock.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      memory_first_launch_seen: false,
    });
    memoryStatusMock.mockResolvedValueOnce({
      status: "ready",
      http_port: 1,
      wire_port: 2,
    });
    render(<MemoryFirstLaunchBanner />);
    await waitFor(() => expect(screen.getByText(/Got it/i)).toBeDefined());
    fireEvent.click(screen.getByText(/Got it/i));
    await waitFor(() =>
      expect(setConfigMock).toHaveBeenCalledWith({
        memory_first_launch_seen: true,
      })
    );
    // After dismiss, the banner unmounts.
    await waitFor(() => expect(screen.queryByText(/Memory layer is on/i)).toBeNull());
  });

  it("hides on getConfig failure (degrades silently, no crash)", async () => {
    getConfigMock.mockRejectedValueOnce(new Error("db gone"));
    const { container } = render(<MemoryFirstLaunchBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });

  it("hides on memoryStatus failure (no banner if daemon path errored)", async () => {
    getConfigMock.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      memory_first_launch_seen: false,
    });
    memoryStatusMock.mockRejectedValueOnce(new Error("ipc closed"));
    const { container } = render(<MemoryFirstLaunchBanner />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.firstChild).toBeNull();
  });
});
