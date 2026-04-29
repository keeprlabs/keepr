import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  memoryStatus,
  memoryWrite,
  memoryRead,
  memoryQuery,
  memorySubjects,
  memoryRelated,
  memorySubscribe,
  isReady,
  isEmptyResult,
  isTransientError,
  type DaemonState,
  type EventRow,
  type MemoryError,
} from "../ctxStore";

describe("ctxStore", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  describe("memoryStatus", () => {
    it("invokes the memory_status Tauri command with no args", async () => {
      const state: DaemonState = { status: "starting" };
      invokeMock.mockResolvedValueOnce(state);
      const got = await memoryStatus();
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledWith("memory_status");
      expect(got).toEqual(state);
    });

    it("returns ready state with port numbers", async () => {
      invokeMock.mockResolvedValueOnce({
        status: "ready",
        http_port: 51234,
        wire_port: 51235,
      } satisfies DaemonState);
      const got = await memoryStatus();
      expect(got.status).toBe("ready");
      if (got.status === "ready") {
        expect(got.http_port).toBe(51234);
        expect(got.wire_port).toBe(51235);
      }
    });

    it("returns offline state with reason", async () => {
      invokeMock.mockResolvedValueOnce({
        status: "offline",
        reason: "ctxd did not become healthy",
      } satisfies DaemonState);
      const got = await memoryStatus();
      expect(got.status).toBe("offline");
      if (got.status === "offline") {
        expect(got.reason).toContain("did not become healthy");
      }
    });

    it("propagates Tauri command errors", async () => {
      invokeMock.mockRejectedValueOnce(new Error("ipc closed"));
      await expect(memoryStatus()).rejects.toThrow("ipc closed");
    });
  });

  describe("memoryWrite", () => {
    it("invokes memory_write with subject, event_type, data", async () => {
      invokeMock.mockResolvedValueOnce("01900000-0000-7000-8000-000000000001");
      const id = await memoryWrite(
        "/keepr/people/uuid-1",
        "person.fact",
        { summary: "shipped feature x" }
      );
      expect(invokeMock).toHaveBeenCalledWith("memory_write", {
        subject: "/keepr/people/uuid-1",
        eventType: "person.fact",
        data: { summary: "shipped feature x" },
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("propagates bad_request error from Rust", async () => {
      const err: MemoryError = {
        kind: "bad_request",
        message: "subject must start with '/'",
      };
      invokeMock.mockRejectedValueOnce(err);
      await expect(memoryWrite("nope", "x", {})).rejects.toMatchObject(err);
    });
  });

  describe("memoryRead", () => {
    it("invokes memory_read with subject and returns event rows", async () => {
      const rows: EventRow[] = [
        {
          id: "uuid-1",
          subject: "/keepr/people/p1",
          event_type: "person.fact",
          data: { summary: "x" },
          timestamp: "2026-04-28T20:00:00+00:00",
        },
      ];
      invokeMock.mockResolvedValueOnce(rows);
      const got = await memoryRead("/keepr/people/p1");
      expect(invokeMock).toHaveBeenCalledWith("memory_read", {
        subject: "/keepr/people/p1",
      });
      expect(got).toEqual(rows);
    });
  });

  describe("memoryQuery", () => {
    it("passes default filters and topK as null when omitted", async () => {
      invokeMock.mockResolvedValueOnce([]);
      await memoryQuery("/keepr/topics");
      expect(invokeMock).toHaveBeenCalledWith("memory_query", {
        subject: "/keepr/topics",
        filters: null,
        topK: null,
      });
    });

    it("passes filters and topK when provided", async () => {
      invokeMock.mockResolvedValueOnce([]);
      await memoryQuery("/keepr/topics", {
        filters: { source: "github", actor: "uuid-1" },
        topK: 50,
      });
      expect(invokeMock).toHaveBeenCalledWith("memory_query", {
        subject: "/keepr/topics",
        filters: { source: "github", actor: "uuid-1" },
        topK: 50,
      });
    });
  });

  describe("memorySubjects", () => {
    it("invokes memory_subjects with prefix and returns string array", async () => {
      invokeMock.mockResolvedValueOnce(["/keepr/people/p1", "/keepr/people/p2"]);
      const got = await memorySubjects("/keepr/people");
      expect(invokeMock).toHaveBeenCalledWith("memory_subjects", {
        prefix: "/keepr/people",
      });
      expect(got).toHaveLength(2);
    });

    it("propagates not_yet_supported (v0.2.7 stub)", async () => {
      const err: MemoryError = {
        kind: "not_yet_supported",
        message: "memory_subjects: ctxd-client v0.3.0 does not expose subject listing",
      };
      invokeMock.mockRejectedValueOnce(err);
      await expect(memorySubjects("/")).rejects.toMatchObject(err);
    });
  });

  describe("memoryRelated", () => {
    it("invokes memory_related with subject", async () => {
      invokeMock.mockResolvedValueOnce([]);
      await memoryRelated("/keepr/people/p1");
      expect(invokeMock).toHaveBeenCalledWith("memory_related", {
        subject: "/keepr/people/p1",
      });
    });

    it("propagates not_yet_supported (v0.2.7 stub)", async () => {
      const err: MemoryError = {
        kind: "not_yet_supported",
        message: "memory_related: ctxd-client v0.3.0 does not expose ctx_related",
      };
      invokeMock.mockRejectedValueOnce(err);
      await expect(memoryRelated("/keepr/people/p1")).rejects.toMatchObject(err);
    });
  });

  describe("memorySubscribe", () => {
    it("invokes memory_subscribe with pattern and returns stub", async () => {
      invokeMock.mockResolvedValueOnce({
        channel_id: "stub",
        note: "stubbed in v0.2.7 PR 2",
      });
      const got = await memorySubscribe("/keepr/**");
      expect(invokeMock).toHaveBeenCalledWith("memory_subscribe", {
        pattern: "/keepr/**",
      });
      expect(got.channel_id).toBe("stub");
    });
  });

  describe("isReady", () => {
    it("narrows to the ready variant when status is ready", () => {
      const state: DaemonState = { status: "ready", http_port: 1, wire_port: 2 };
      expect(isReady(state)).toBe(true);
      if (isReady(state)) {
        const _h: number = state.http_port;
        const _w: number = state.wire_port;
        void _h;
        void _w;
      }
    });

    it("returns false for non-ready states", () => {
      expect(isReady({ status: "starting" })).toBe(false);
      expect(isReady({ status: "offline", reason: "x" })).toBe(false);
    });
  });

  describe("isEmptyResult", () => {
    it("returns true for not_found and not_yet_supported", () => {
      expect(isEmptyResult({ kind: "not_found", message: "x" })).toBe(true);
      expect(isEmptyResult({ kind: "not_yet_supported", message: "x" })).toBe(true);
    });
    it("returns false for other kinds and non-objects", () => {
      expect(isEmptyResult({ kind: "offline", message: "x" })).toBe(false);
      expect(isEmptyResult({ kind: "internal", message: "x" })).toBe(false);
      expect(isEmptyResult(null)).toBe(false);
      expect(isEmptyResult("string")).toBe(false);
    });
  });

  describe("isTransientError", () => {
    it("returns true for offline and timeout", () => {
      expect(isTransientError({ kind: "offline", message: "x" })).toBe(true);
      expect(isTransientError({ kind: "timeout", message: "x" })).toBe(true);
    });
    it("returns false for non-transient kinds", () => {
      expect(isTransientError({ kind: "bad_request", message: "x" })).toBe(false);
      expect(isTransientError({ kind: "not_found", message: "x" })).toBe(false);
    });
  });
});
