import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TeamMember } from "../../lib/types";
import { DEFAULT_CONFIG } from "../../lib/types";

const memoryWriteMock = vi.fn();
const ensureCtxdUuidMock = vi.fn();
const getConfigMock = vi.fn();
const logWarnMock = vi.fn();

vi.mock("../ctxStore", () => ({
  memoryWrite: (...a: unknown[]) => memoryWriteMock(...a),
}));

vi.mock("../db", () => ({
  ensureCtxdUuid: (...a: unknown[]) => ensureCtxdUuidMock(...a),
  getConfig: (...a: unknown[]) => getConfigMock(...a),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  warn: (...a: unknown[]) => logWarnMock(...a),
  info: vi.fn(),
}));

import { dualWriteSession } from "../memory";

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

const baseArgs = {
  workflow: "team_pulse" as const,
  targetSlug: null,
  targetDisplayName: null,
  members: [member(1, "Priya Raman", "priya-raman")],
  visibleMarkdown: "# Team Pulse\n\nShipped feature x and unblocked Tomás.",
  byPerson: new Map<number, Array<{ personId: number; line: string }>>(),
  topics: [] as Array<{ name: string; bullets: string[] }>,
  dateStamp: "2026-04-29",
  timeRange: { start: "2026-04-22", end: "2026-04-29" },
  sessionFile: "/tmp/keepr/sessions/2026-04-29-team-pulse.md",
};

beforeEach(() => {
  memoryWriteMock.mockReset();
  ensureCtxdUuidMock.mockReset();
  getConfigMock.mockReset();
  logWarnMock.mockReset();
  memoryWriteMock.mockResolvedValue("01900000-0000-7000-8000-000000000000");
  ensureCtxdUuidMock.mockResolvedValue("01900000-0000-7000-8000-000000000001");
  getConfigMock.mockResolvedValue({ ...DEFAULT_CONFIG, memory_dual_write: true });
});

describe("dualWriteSession — kill switch", () => {
  it("writes nothing when memory_dual_write is false", async () => {
    getConfigMock.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      memory_dual_write: false,
    });
    await dualWriteSession({ ...baseArgs });
    expect(memoryWriteMock).not.toHaveBeenCalled();
    expect(ensureCtxdUuidMock).not.toHaveBeenCalled();
  });
});

describe("dualWriteSession — per-workflow events", () => {
  it("team_pulse emits session.completed AND status.updated", async () => {
    await dualWriteSession({ ...baseArgs, workflow: "team_pulse" });
    const calls = memoryWriteMock.mock.calls;
    const types = calls.map((c) => c[1]);
    expect(types).toContain("session.completed");
    expect(types).toContain("status.updated");

    const sessionCall = calls.find((c) => c[1] === "session.completed")!;
    expect(sessionCall[0]).toBe("/keepr/sessions/2026-04-29/team_pulse/team-pulse");
    expect(sessionCall[2].schema_version).toBe(1);
    expect(sessionCall[2].workflow).toBe("team_pulse");

    const statusCall = calls.find((c) => c[1] === "status.updated")!;
    expect(statusCall[0]).toBe("/keepr/status");
  });

  it("weekly_update emits both session.completed AND status.updated", async () => {
    await dualWriteSession({ ...baseArgs, workflow: "weekly_update" });
    const types = memoryWriteMock.mock.calls.map((c) => c[1]);
    expect(types).toContain("session.completed");
    expect(types).toContain("status.updated");
  });

  it("one_on_one_prep emits ONLY session.completed (no status update)", async () => {
    await dualWriteSession({
      ...baseArgs,
      workflow: "one_on_one_prep",
      targetSlug: "priya-raman",
      targetDisplayName: "Priya Raman",
    });
    const types = memoryWriteMock.mock.calls.map((c) => c[1]);
    expect(types).toContain("session.completed");
    expect(types).not.toContain("status.updated");

    const sessionCall = memoryWriteMock.mock.calls.find(
      (c) => c[1] === "session.completed"
    )!;
    expect(sessionCall[0]).toBe(
      "/keepr/sessions/2026-04-29/one_on_one_prep/1on1-priya-raman"
    );
  });
});

describe("dualWriteSession — person facts", () => {
  it("emits one person.fact event per delta line, looking up ctxd_uuid lazily", async () => {
    const byPerson = new Map<number, Array<{ personId: number; line: string }>>();
    byPerson.set(1, [
      { personId: 1, line: "Shipped feature x" },
      { personId: 1, line: "Reviewed 4 PRs" },
    ]);
    await dualWriteSession({ ...baseArgs, byPerson });

    expect(ensureCtxdUuidMock).toHaveBeenCalledWith(1);
    const personCalls = memoryWriteMock.mock.calls.filter((c) => c[1] === "person.fact");
    expect(personCalls).toHaveLength(2);
    expect(personCalls[0][0]).toBe(
      "/keepr/people/01900000-0000-7000-8000-000000000001"
    );
    expect(personCalls[0][2].line).toBe("Shipped feature x");
    expect(personCalls[1][2].line).toBe("Reviewed 4 PRs");
  });

  it("skips members whose ctxd_uuid lookup fails (logs warning, no event)", async () => {
    ensureCtxdUuidMock.mockRejectedValueOnce(new Error("db gone"));
    const byPerson = new Map<number, Array<{ personId: number; line: string }>>();
    byPerson.set(1, [{ personId: 1, line: "ought to fail" }]);
    await dualWriteSession({ ...baseArgs, byPerson });

    const personCalls = memoryWriteMock.mock.calls.filter((c) => c[1] === "person.fact");
    expect(personCalls).toHaveLength(0);
    expect(logWarnMock).toHaveBeenCalled();
  });

  it("skips deltas referencing unknown member ids (no member in args.members)", async () => {
    const byPerson = new Map<number, Array<{ personId: number; line: string }>>();
    byPerson.set(999, [{ personId: 999, line: "ghost member" }]);
    await dualWriteSession({ ...baseArgs, byPerson });

    expect(ensureCtxdUuidMock).not.toHaveBeenCalled();
    const personCalls = memoryWriteMock.mock.calls.filter((c) => c[1] === "person.fact");
    expect(personCalls).toHaveLength(0);
  });
});

describe("dualWriteSession — topics", () => {
  it("emits one topic.note event per topic with slugged subject", async () => {
    const topics = [
      { name: "Auth Rewrite", bullets: ["RFC merged", "Tests passing"] },
      { name: "K8s Migration", bullets: ["Pilot launched"] },
    ];
    await dualWriteSession({ ...baseArgs, topics });

    const topicCalls = memoryWriteMock.mock.calls.filter((c) => c[1] === "topic.note");
    expect(topicCalls).toHaveLength(2);
    expect(topicCalls[0][0]).toBe("/keepr/topics/auth-rewrite");
    expect(topicCalls[0][2].name).toBe("Auth Rewrite");
    expect(topicCalls[0][2].bullets).toEqual(["RFC merged", "Tests passing"]);
    expect(topicCalls[1][0]).toBe("/keepr/topics/k8s-migration");
  });
});

describe("dualWriteSession — failure tolerance", () => {
  it("logs (does not throw) when memoryWrite rejects for individual events", async () => {
    memoryWriteMock.mockRejectedValueOnce(new Error("offline"));
    memoryWriteMock.mockResolvedValueOnce("ok-session");

    // team_pulse: 2 writes (session + status). Make the first reject, second succeed.
    await expect(dualWriteSession({ ...baseArgs })).resolves.toBeUndefined();
    expect(logWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("dual-write")
    );
  });

  it("does not throw when ALL writes reject", async () => {
    memoryWriteMock.mockRejectedValue(new Error("offline"));
    await expect(dualWriteSession({ ...baseArgs })).resolves.toBeUndefined();
    expect(logWarnMock).toHaveBeenCalled();
  });
});

describe("dualWriteSession — schema_version", () => {
  it("every event payload includes schema_version=1", async () => {
    const byPerson = new Map<number, Array<{ personId: number; line: string }>>();
    byPerson.set(1, [{ personId: 1, line: "x" }]);
    await dualWriteSession({
      ...baseArgs,
      byPerson,
      topics: [{ name: "T", bullets: ["b"] }],
    });
    for (const [, , data] of memoryWriteMock.mock.calls) {
      expect(data.schema_version).toBe(1);
    }
  });
});
