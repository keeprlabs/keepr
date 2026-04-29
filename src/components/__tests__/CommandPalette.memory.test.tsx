// Memory-layer behavior of the cmd+k palette (v0.2.7 PR 5). The palette
// already had file/session/action search; this suite covers the new
// `memory_query`-backed rows.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryQueryMock = vi.fn();
vi.mock("../../services/ctxStore", () => ({
  memoryQuery: (...a: unknown[]) => memoryQueryMock(...a),
  isEmptyResult: (err: unknown) => {
    if (typeof err !== "object" || err === null) return false;
    const e = err as { kind?: string };
    return e.kind === "not_found" || e.kind === "not_yet_supported";
  },
}));

vi.mock("../../services/search", () => ({
  buildSearchCorpus: vi.fn(async () => []),
  searchCorpus: vi.fn(() => []),
}));

import { CommandPalette, type CommandAction } from "../CommandPalette";

const noopActions: CommandAction[] = [];

beforeEach(() => {
  memoryQueryMock.mockReset();
});

describe("CommandPalette — memory hits", () => {
  it("does NOT call memoryQuery when query is empty", async () => {
    render(
      <CommandPalette
        open
        onClose={() => {}}
        members={[]}
        actions={noopActions}
      />
    );
    // Wait for any pending effects to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(memoryQueryMock).not.toHaveBeenCalled();
  });

  it("does NOT call memoryQuery for queries shorter than 2 chars", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        members={[]}
        actions={noopActions}
      />
    );
    const input = screen.getByPlaceholderText(/Search commands/i);
    await user.type(input, "a");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(memoryQueryMock).not.toHaveBeenCalled();
  });

  it("debounces memoryQuery calls (one per quiescent input)", async () => {
    memoryQueryMock.mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        members={[]}
        actions={noopActions}
      />
    );
    const input = screen.getByPlaceholderText(/Search commands/i);
    // Type a stream of chars — only the final value triggers a fetch.
    await user.type(input, "priya");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(memoryQueryMock).toHaveBeenCalledTimes(1);
  });

  it("renders memory hits with subject + snippet", async () => {
    memoryQueryMock.mockResolvedValue([
      {
        id: "ev1",
        subject: "/keepr/people/uuid-1",
        event_type: "person.fact",
        data: { display_name: "Priya Raman", line: "Shipped feature x" },
        timestamp: "2026-04-29T00:00:00+00:00",
      },
    ]);
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        members={[]}
        actions={noopActions}
      />
    );
    await user.type(screen.getByPlaceholderText(/Search commands/i), "priya");
    await waitFor(() => {
      expect(screen.getByText("In memory layer")).toBeDefined();
    });
    // Title pulled from data.line/data.summary/etc, not event_type.
    expect(screen.getByText("Shipped feature x")).toBeDefined();
    // Subject path rendered as the secondary line.
    expect(screen.getByText("/keepr/people/uuid-1")).toBeDefined();
    // The "person" label badge renders.
    expect(screen.getByText("person")).toBeDefined();
  });

  it("handles transient errors as empty results (no toast, no crash)", async () => {
    memoryQueryMock.mockRejectedValue({
      kind: "offline",
      message: "memory layer offline",
    });
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        members={[]}
        actions={noopActions}
      />
    );
    await user.type(screen.getByPlaceholderText(/Search commands/i), "anything");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    // Should reach the "Nothing matches" empty state without throwing.
    expect(screen.getByText(/Nothing matches/i)).toBeDefined();
  });

  it("handles not_yet_supported (no error, just empty)", async () => {
    memoryQueryMock.mockRejectedValue({
      kind: "not_yet_supported",
      message: "ctxd-client v0.3.0 doesn't expose this",
    });
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onClose={() => {}}
        members={[]}
        actions={noopActions}
      />
    );
    await user.type(screen.getByPlaceholderText(/Search commands/i), "foo");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(screen.getByText(/Nothing matches/i)).toBeDefined();
  });

  it("invokes onNavigateSubject and closes on Enter for a memory row", async () => {
    memoryQueryMock.mockResolvedValue([
      {
        id: "ev1",
        subject: "/keepr/topics/auth-rewrite",
        event_type: "topic.note",
        data: { name: "Auth Rewrite", bullets: ["RFC merged"] },
        timestamp: "2026-04-29T00:00:00+00:00",
      },
    ]);
    const onNavigateSubject = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onClose={onClose}
        members={[]}
        actions={noopActions}
        onNavigateSubject={onNavigateSubject}
      />
    );
    const input = screen.getByPlaceholderText(/Search commands/i);
    await user.type(input, "auth");
    await waitFor(() => {
      expect(screen.getByText("Auth Rewrite")).toBeDefined();
    });
    // The memory row is the only result, so cursor=0 selects it.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNavigateSubject).toHaveBeenCalledWith("/keepr/topics/auth-rewrite");
    expect(onClose).toHaveBeenCalled();
  });

  it("clears memory hits when palette closes", async () => {
    memoryQueryMock.mockResolvedValue([
      {
        id: "ev1",
        subject: "/keepr/topics/x",
        event_type: "topic.note",
        data: { name: "X marks spot" },
        timestamp: "2026-04-29T00:00:00+00:00",
      },
    ]);
    const user = userEvent.setup();
    const { rerender } = render(
      <CommandPalette
        open
        onClose={() => {}}
        members={[]}
        actions={noopActions}
      />
    );
    await user.type(screen.getByPlaceholderText(/Search commands/i), "xx");
    await waitFor(() =>
      expect(screen.queryByText("In memory layer")).not.toBeNull()
    );
    rerender(
      <CommandPalette
        open={false}
        onClose={() => {}}
        members={[]}
        actions={noopActions}
      />
    );
    rerender(
      <CommandPalette
        open
        onClose={() => {}}
        members={[]}
        actions={noopActions}
      />
    );
    // After close+reopen with no query yet, no memory hits should render.
    expect(screen.queryByText("In memory layer")).toBeNull();
  });
});
