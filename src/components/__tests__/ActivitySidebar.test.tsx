import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const memorySubscribeMock = vi.fn();
vi.mock("../../services/ctxStore", () => ({
  memorySubscribe: (...a: unknown[]) => memorySubscribeMock(...a),
  isTransientError: (err: unknown) => {
    if (typeof err !== "object" || err === null) return false;
    const e = err as { kind?: string };
    return e.kind === "offline" || e.kind === "timeout";
  },
}));

import { ActivitySidebar } from "../ActivitySidebar";

beforeEach(() => {
  memorySubscribeMock.mockReset();
  memorySubscribeMock.mockResolvedValue({
    channel_id: "stub",
    note: "subscribe stubbed",
  });
});

describe("ActivitySidebar", () => {
  it("starts collapsed; does not call memory_subscribe until opened", async () => {
    render(<ActivitySidebar />);
    expect(screen.getByRole("button", { name: /open activity sidebar/i })).toBeDefined();
    expect(memorySubscribeMock).not.toHaveBeenCalled();
  });

  it("opens on toggle click and calls memory_subscribe with the default pattern", async () => {
    const user = userEvent.setup();
    render(<ActivitySidebar />);
    await user.click(screen.getByRole("button", { name: /open activity sidebar/i }));
    await waitFor(() => expect(memorySubscribeMock).toHaveBeenCalledWith("/keepr/**"));
  });

  it("uses the pattern prop when provided", async () => {
    const user = userEvent.setup();
    render(<ActivitySidebar pattern="/work/**" />);
    await user.click(screen.getByRole("button", { name: /open activity sidebar/i }));
    await waitFor(() => expect(memorySubscribeMock).toHaveBeenCalledWith("/work/**"));
  });

  it("renders the stub preview with the SDK note when subscribe resolves", async () => {
    memorySubscribeMock.mockResolvedValueOnce({
      channel_id: "stub-1",
      note: "subscribe is stubbed in v0.2.7 PR 2; live feed lands in PR 9",
    });
    const user = userEvent.setup();
    render(<ActivitySidebar />);
    await user.click(screen.getByRole("button", { name: /open activity sidebar/i }));
    await waitFor(() => expect(screen.getByText(/Coming in v0.4/)).toBeDefined());
    expect(screen.getByText(/What you'll see/i)).toBeDefined();
    // Debug line shows the raw SDK note for engineers.
    expect(screen.getByText(/subscribe is stubbed/)).toBeDefined();
  });

  it("renders the offline hint for transient errors", async () => {
    memorySubscribeMock.mockRejectedValueOnce({
      kind: "offline",
      message: "memory layer offline",
    });
    const user = userEvent.setup();
    render(<ActivitySidebar />);
    await user.click(screen.getByRole("button", { name: /open activity sidebar/i }));
    await waitFor(() =>
      expect(screen.getByText(/Memory layer offline/i)).toBeDefined()
    );
  });

  it("renders generic error for non-transient failures", async () => {
    memorySubscribeMock.mockRejectedValueOnce({
      kind: "internal",
      message: "boom",
    });
    const user = userEvent.setup();
    render(<ActivitySidebar />);
    await user.click(screen.getByRole("button", { name: /open activity sidebar/i }));
    await waitFor(() =>
      expect(screen.getByText("Couldn't connect")).toBeDefined()
    );
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("close button collapses the panel and resets status", async () => {
    const user = userEvent.setup();
    render(<ActivitySidebar />);
    await user.click(screen.getByRole("button", { name: /open activity sidebar/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/dismiss activity panel/i)).toBeDefined()
    );
    fireEvent.click(screen.getByLabelText(/dismiss activity panel/i));
    expect(
      screen.getByRole("button", { name: /open activity sidebar/i })
    ).toBeDefined();
    expect(screen.queryByText(/What you'll see/i)).toBeNull();
  });

  it("the panel header shows the subscription pattern", async () => {
    const user = userEvent.setup();
    render(<ActivitySidebar pattern="/keepr/people/**" />);
    await user.click(screen.getByRole("button", { name: /open activity sidebar/i }));
    await waitFor(() => expect(screen.getByText("/keepr/people/**")).toBeDefined());
  });
});
