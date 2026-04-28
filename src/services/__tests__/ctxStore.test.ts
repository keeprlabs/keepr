import { describe, expect, it, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { memoryStatus, isReady, type DaemonState } from "../ctxStore";

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
        reason: "ctxd did not become healthy: tcp connect refused",
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

  describe("isReady", () => {
    it("narrows to the ready variant when status is ready", () => {
      const state: DaemonState = { status: "ready", http_port: 1, wire_port: 2 };
      expect(isReady(state)).toBe(true);
      if (isReady(state)) {
        // type-level check: this only compiles when narrowing works.
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
});
