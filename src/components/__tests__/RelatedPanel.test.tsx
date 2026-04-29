import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryRelatedMock = vi.fn();
vi.mock("../../services/ctxStore", () => ({
  memoryRelated: (...a: unknown[]) => memoryRelatedMock(...a),
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

import { RelatedPanel } from "../RelatedPanel";

beforeEach(() => {
  memoryRelatedMock.mockReset();
});

describe("RelatedPanel", () => {
  it("renders nothing when subject is null", () => {
    const { container } = render(<RelatedPanel subject={null} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
    expect(memoryRelatedMock).not.toHaveBeenCalled();
  });

  it("calls memory_related on mount with the given subject", async () => {
    memoryRelatedMock.mockResolvedValue([]);
    render(<RelatedPanel subject="/keepr/people/uuid-1" onClose={() => {}} />);
    await waitFor(() =>
      expect(memoryRelatedMock).toHaveBeenCalledWith("/keepr/people/uuid-1")
    );
  });

  it("renders the empty state when memory_related returns []", async () => {
    memoryRelatedMock.mockResolvedValue([]);
    render(<RelatedPanel subject="/keepr/topics/x" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("No related memory yet")).toBeDefined()
    );
  });

  it("renders the 'Coming soon' state for not_yet_supported (v0.2.7 SDK gap)", async () => {
    memoryRelatedMock.mockRejectedValue({
      kind: "not_yet_supported",
      message: "ctxd-client v0.3.0 lacks ctx_related",
    });
    render(<RelatedPanel subject="/keepr/topics/x" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Coming soon")).toBeDefined());
    expect(screen.getByText(/v0.4/i)).toBeDefined();
  });

  it("renders 'Memory layer offline' for transient errors", async () => {
    memoryRelatedMock.mockRejectedValue({
      kind: "offline",
      message: "memory layer offline",
    });
    render(<RelatedPanel subject="/keepr/topics/x" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("Memory layer offline")).toBeDefined()
    );
  });

  it("renders 'Something went wrong' for unrecognized errors", async () => {
    memoryRelatedMock.mockRejectedValue({
      kind: "internal",
      message: "boom",
    });
    render(<RelatedPanel subject="/keepr/topics/x" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText("Something went wrong")).toBeDefined()
    );
    expect(screen.getByText("boom")).toBeDefined();
  });

  it("renders related events grouped by relation field on data payload", async () => {
    memoryRelatedMock.mockResolvedValue([
      {
        id: "a",
        subject: "/keepr/people/uuid-1",
        event_type: "person.fact",
        data: { line: "Authored", relation: "actor" },
        timestamp: "2026-04-29T00:00:00+00:00",
      },
      {
        id: "b",
        subject: "/keepr/topics/auth-rewrite",
        event_type: "topic.note",
        data: { name: "Linked topic", relation: "mentions" },
        timestamp: "2026-04-29T00:00:00+00:00",
      },
    ]);
    render(<RelatedPanel subject="/keepr/sessions/x" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("actor")).toBeDefined();
      expect(screen.getByText("mentions")).toBeDefined();
    });
    expect(screen.getByText("Authored")).toBeDefined();
    expect(screen.getByText("Linked topic")).toBeDefined();
  });

  it("falls back to event_type for grouping when relation field is absent", async () => {
    memoryRelatedMock.mockResolvedValue([
      {
        id: "a",
        subject: "/keepr/people/uuid-1",
        event_type: "person.fact",
        data: { line: "x" },
        timestamp: "2026-04-29T00:00:00+00:00",
      },
    ]);
    render(<RelatedPanel subject="/keepr/sessions/x" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("person.fact")).toBeDefined());
  });

  it("clicking a row fires onOpenSubject", async () => {
    memoryRelatedMock.mockResolvedValue([
      {
        id: "a",
        subject: "/keepr/topics/auth-rewrite",
        event_type: "topic.note",
        data: { name: "Auth Rewrite" },
        timestamp: "2026-04-29T00:00:00+00:00",
      },
    ]);
    const onOpenSubject = vi.fn();
    render(
      <RelatedPanel
        subject="/keepr/sessions/x"
        onClose={() => {}}
        onOpenSubject={onOpenSubject}
      />
    );
    await waitFor(() => expect(screen.getByText("Auth Rewrite")).toBeDefined());
    fireEvent.click(screen.getByText("Auth Rewrite"));
    expect(onOpenSubject).toHaveBeenCalledWith("/keepr/topics/auth-rewrite");
  });

  it("close button fires onClose", async () => {
    memoryRelatedMock.mockResolvedValue([]);
    const onClose = vi.fn();
    render(<RelatedPanel subject="/keepr/topics/x" onClose={onClose} />);
    await waitFor(() => expect(screen.getByLabelText(/close related/i)).toBeDefined());
    fireEvent.click(screen.getByLabelText(/close related/i));
    expect(onClose).toHaveBeenCalled();
  });

  it("re-fetches when subject changes", async () => {
    memoryRelatedMock.mockResolvedValue([]);
    const { rerender } = render(
      <RelatedPanel subject="/keepr/topics/a" onClose={() => {}} />
    );
    await waitFor(() => expect(memoryRelatedMock).toHaveBeenCalledTimes(1));
    rerender(<RelatedPanel subject="/keepr/topics/b" onClose={() => {}} />);
    await waitFor(() => expect(memoryRelatedMock).toHaveBeenCalledTimes(2));
    expect(memoryRelatedMock).toHaveBeenLastCalledWith("/keepr/topics/b");
  });
});
