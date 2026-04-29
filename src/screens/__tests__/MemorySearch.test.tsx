import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamMember } from "../../lib/types";

const memoryQueryMock = vi.fn();
vi.mock("../../services/ctxStore", () => ({
  memoryQuery: (...a: unknown[]) => memoryQueryMock(...a),
  isEmptyResult: (err: unknown) => {
    if (typeof err !== "object" || err === null) return false;
    const e = err as { kind?: string };
    return e.kind === "not_found" || e.kind === "not_yet_supported";
  },
  isTransientError: (err: unknown) => {
    if (typeof err !== "object" || err === null) return false;
    const e = err as { kind?: string };
    return e.kind === "offline" || e.kind === "timeout";
  },
}));

import { MemorySearch } from "../MemorySearch";

const member = (id: number, name: string, slug: string): TeamMember => ({
  id,
  display_name: name,
  github_handle: null,
  gitlab_username: null,
  slack_user_id: null,
  jira_username: null,
  linear_username: null,
  slug,
  ctxd_uuid: null,
});

beforeEach(() => {
  memoryQueryMock.mockReset();
  memoryQueryMock.mockResolvedValue([]);
});

describe("MemorySearch", () => {
  it("renders the empty state when no results return", async () => {
    render(<MemorySearch members={[]} />);
    await waitFor(() => expect(memoryQueryMock).toHaveBeenCalled());
    expect(screen.getByText("Memory is empty.")).toBeDefined();
  });

  it("renders the offline banner when memory_query returns offline", async () => {
    memoryQueryMock.mockRejectedValueOnce({
      kind: "offline",
      message: "memory layer offline",
    });
    render(<MemorySearch members={[]} />);
    await waitFor(() =>
      expect(screen.getByText(/Memory layer is offline/i)).toBeDefined()
    );
  });

  it("collapses not_yet_supported into empty state without erroring", async () => {
    memoryQueryMock.mockRejectedValueOnce({
      kind: "not_yet_supported",
      message: "future SDK",
    });
    render(<MemorySearch members={[]} />);
    await waitFor(() => expect(screen.getByText("Memory is empty.")).toBeDefined());
  });

  it("renders rows from memory_query results", async () => {
    memoryQueryMock.mockResolvedValueOnce([
      {
        id: "ev1",
        subject: "/keepr/people/uuid-1",
        event_type: "person.fact",
        data: { display_name: "Priya", line: "Shipped feature x" },
        timestamp: new Date().toISOString(),
      },
      {
        id: "ev2",
        subject: "/keepr/topics/auth-rewrite",
        event_type: "topic.note",
        data: { name: "Auth Rewrite" },
        timestamp: new Date().toISOString(),
      },
    ]);
    render(<MemorySearch members={[]} />);
    await waitFor(() => {
      expect(screen.getByText("Shipped feature x")).toBeDefined();
      expect(screen.getByText("Auth Rewrite")).toBeDefined();
    });
    expect(screen.getByText("/keepr/people/uuid-1")).toBeDefined();
    expect(screen.getByText("/keepr/topics/auth-rewrite")).toBeDefined();
  });

  it("filters by source — keepr filter excludes /keepr/evidence", async () => {
    memoryQueryMock.mockResolvedValueOnce([
      {
        id: "a",
        subject: "/keepr/topics/x",
        event_type: "topic.note",
        data: { name: "Topic X" },
        timestamp: new Date().toISOString(),
      },
      {
        id: "b",
        subject: "/keepr/evidence/github/acme/repo/pulls/42/ev1",
        event_type: "evidence.recorded",
        data: { name: "Evidence Y" },
        timestamp: new Date().toISOString(),
      },
    ]);
    const user = userEvent.setup();
    render(<MemorySearch members={[]} />);
    await waitFor(() => expect(screen.getByText("Topic X")).toBeDefined());

    // Click the "keepr" source chip to scope to keepr-only events.
    await user.click(screen.getByRole("button", { name: "keepr" }));
    expect(screen.getByText("Topic X")).toBeDefined();
    expect(screen.queryByText("Evidence Y")).toBeNull();
  });

  it("filters by source — github includes /keepr/evidence/github and /work/github", async () => {
    memoryQueryMock.mockResolvedValueOnce([
      {
        id: "a",
        subject: "/keepr/topics/x",
        event_type: "topic.note",
        data: { name: "Keepr-Topic" },
        timestamp: new Date().toISOString(),
      },
      {
        id: "b",
        subject: "/keepr/evidence/github/acme/repo/pulls/42/ev1",
        event_type: "evidence.recorded",
        data: { name: "GitHub-Bridge" },
        timestamp: new Date().toISOString(),
      },
    ]);
    const user = userEvent.setup();
    render(<MemorySearch members={[]} />);
    await waitFor(() => expect(screen.getByText("Keepr-Topic")).toBeDefined());

    await user.click(screen.getByRole("button", { name: "github" }));
    expect(screen.getByText("GitHub-Bridge")).toBeDefined();
    expect(screen.queryByText("Keepr-Topic")).toBeNull();
  });

  it("range filter (7d) hides results older than 7 days", async () => {
    const longAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    memoryQueryMock.mockResolvedValueOnce([
      {
        id: "old",
        subject: "/keepr/topics/old",
        event_type: "topic.note",
        data: { name: "Old item" },
        timestamp: longAgo,
      },
      {
        id: "new",
        subject: "/keepr/topics/new",
        event_type: "topic.note",
        data: { name: "Today item" },
        timestamp: new Date().toISOString(),
      },
    ]);
    const user = userEvent.setup();
    render(<MemorySearch members={[]} />);
    await waitFor(() => expect(screen.getByText("Old item")).toBeDefined());

    await user.click(screen.getByRole("button", { name: "7d" }));
    expect(screen.getByText("Today item")).toBeDefined();
    expect(screen.queryByText("Old item")).toBeNull();
  });

  it("clicking a result fires onOpenSubject with the event subject", async () => {
    memoryQueryMock.mockResolvedValueOnce([
      {
        id: "a",
        subject: "/keepr/people/uuid-1",
        event_type: "person.fact",
        data: { line: "Click me" },
        timestamp: new Date().toISOString(),
      },
    ]);
    const onOpenSubject = vi.fn();
    render(<MemorySearch members={[]} onOpenSubject={onOpenSubject} />);
    await waitFor(() => expect(screen.getByText("Click me")).toBeDefined());

    fireEvent.click(screen.getByText("Click me"));
    expect(onOpenSubject).toHaveBeenCalledWith("/keepr/people/uuid-1");
  });

  it("initialSubject scopes the query call", async () => {
    render(
      <MemorySearch members={[]} initialSubject="/keepr/people/uuid-1" />
    );
    await waitFor(() =>
      expect(memoryQueryMock).toHaveBeenCalledWith(
        "/keepr/people/uuid-1",
        expect.any(Object)
      )
    );
    // Subject filter chip rendered with the active subject.
    expect(screen.getByText(/\/keepr\/people\/uuid-1 ×/)).toBeDefined();
  });

  it("typing in the search box debounces (one fetch per quiescent input)", async () => {
    const user = userEvent.setup();
    render(<MemorySearch members={[]} />);
    // Initial mount fires once.
    await waitFor(() => expect(memoryQueryMock).toHaveBeenCalledTimes(1));
    memoryQueryMock.mockClear();

    const input = screen.getByPlaceholderText(/Search memory/i);
    await user.type(input, "hello");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    // Should fire exactly once after the user stops typing.
    expect(memoryQueryMock).toHaveBeenCalledTimes(1);
  });

  it("renders the person-filter row when members are passed", async () => {
    render(<MemorySearch members={[member(1, "Priya Raman", "priya")]} />);
    expect(screen.getByText("Priya Raman")).toBeDefined();
  });
});
