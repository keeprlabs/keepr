import { describe, expect, it, vi, beforeEach } from "vitest";
import { DEFAULT_CONFIG } from "../../lib/types";

const memoryWriteMock = vi.fn();
const getConfigMock = vi.fn();
const logWarnMock = vi.fn();

vi.mock("../ctxStore", () => ({
  memoryWrite: (...a: unknown[]) => memoryWriteMock(...a),
}));

vi.mock("../db", () => ({
  ensureCtxdUuid: vi.fn(),
  getConfig: (...a: unknown[]) => getConfigMock(...a),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  warn: (...a: unknown[]) => logWarnMock(...a),
  info: vi.fn(),
}));

import { dualWriteEvidenceBatch } from "../memory";

const baseRow = {
  source: "github_pr",
  source_url: "https://github.com/acme/web/pull/42",
  source_id: "42",
  actor_member_id: 1,
  timestamp_at: "2026-04-29T00:00:00+00:00",
  content: "PR description text".repeat(50), // long enough to test snippet truncation
  subject_path: "/keepr/evidence/github/acme/web/pulls/42/42",
};

beforeEach(() => {
  memoryWriteMock.mockReset();
  getConfigMock.mockReset();
  logWarnMock.mockReset();
  memoryWriteMock.mockResolvedValue("event-id");
  getConfigMock.mockResolvedValue({ ...DEFAULT_CONFIG, memory_dual_write: true });
});

describe("dualWriteEvidenceBatch", () => {
  it("writes nothing when memory_dual_write is false", async () => {
    getConfigMock.mockResolvedValueOnce({
      ...DEFAULT_CONFIG,
      memory_dual_write: false,
    });
    await dualWriteEvidenceBatch([baseRow]);
    expect(memoryWriteMock).not.toHaveBeenCalled();
  });

  it("writes nothing for empty input", async () => {
    await dualWriteEvidenceBatch([]);
    expect(memoryWriteMock).not.toHaveBeenCalled();
    expect(getConfigMock).toHaveBeenCalledTimes(1);
  });

  it("skips rows without a subject_path", async () => {
    await dualWriteEvidenceBatch([{ ...baseRow, subject_path: null }]);
    expect(memoryWriteMock).not.toHaveBeenCalled();
  });

  it("emits one evidence.recorded event per row with subject_path", async () => {
    await dualWriteEvidenceBatch([baseRow, { ...baseRow, source_id: "43", subject_path: "/keepr/evidence/github/acme/web/pulls/42/43" }]);
    expect(memoryWriteMock).toHaveBeenCalledTimes(2);
    const [subject, type, data] = memoryWriteMock.mock.calls[0];
    expect(subject).toBe(baseRow.subject_path);
    expect(type).toBe("evidence.recorded");
    expect(data.schema_version).toBe(1);
    expect(data.source).toBe("github_pr");
    expect(data.source_url).toBe(baseRow.source_url);
    expect(data.actor_member_id).toBe(1);
    // content_snippet is truncated to 280 chars max.
    expect(data.content_snippet.length).toBeLessThanOrEqual(280);
  });

  it("tolerates per-row write failures (logs once, does not throw)", async () => {
    memoryWriteMock.mockRejectedValueOnce(new Error("offline"));
    memoryWriteMock.mockResolvedValueOnce("ok");
    await expect(
      dualWriteEvidenceBatch([
        baseRow,
        { ...baseRow, source_id: "43", subject_path: "/keepr/evidence/x/y" },
      ])
    ).resolves.toBeUndefined();
    expect(logWarnMock).toHaveBeenCalledTimes(1);
    expect(logWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("evidence dual-write")
    );
  });

  it("handles all rows skipped (subject_path null) — no warn, no calls", async () => {
    await dualWriteEvidenceBatch([
      { ...baseRow, subject_path: null },
      { ...baseRow, subject_path: null, source_id: "43" },
    ]);
    expect(memoryWriteMock).not.toHaveBeenCalled();
    expect(logWarnMock).not.toHaveBeenCalled();
  });
});
