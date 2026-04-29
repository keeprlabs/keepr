// Updater singleton tests. The singleton is the brain — coalescing
// concurrent callers, short-circuiting once we're ready, falling back
// to GitHub-API on plugin failure, and protecting in-flight pulses.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkMock = vi.fn<() => Promise<any>>();
const downloadAndInstallMock = vi.fn<() => Promise<void>>(async () => {});
const dbSelectMock = vi.fn<(sql: string, params?: unknown) => Promise<Array<{ cnt: number }>>>(
  async () => [{ cnt: 0 }]
);
const httpFetchMock = vi.fn<(url: string, init?: any) => Promise<any>>();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => checkMock(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: (url: string, init?: any) => httpFetchMock(url, init),
}));

vi.mock("../db", () => ({
  db: vi.fn(async () => ({
    select: (sql: string, params?: unknown) => dbSelectMock(sql, params),
  })),
}));

import {
  _resetForTests,
  checkForUpdate,
  getState,
  subscribe,
} from "../updater";

function makeUpdate(version: string) {
  return { version, downloadAndInstall: downloadAndInstallMock };
}

beforeEach(() => {
  _resetForTests();
  checkMock.mockReset();
  downloadAndInstallMock.mockReset();
  downloadAndInstallMock.mockResolvedValue(undefined);
  dbSelectMock.mockReset();
  dbSelectMock.mockResolvedValue([{ cnt: 0 }]);
  httpFetchMock.mockReset();
  localStorage.clear();
  (globalThis as any).__KEEPR_VERSION__ = "0.2.5";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkForUpdate — plugin path", () => {
  it("transitions idle → ready when a newer update exists", async () => {
    checkMock.mockResolvedValue(makeUpdate("0.2.6"));
    const result = await checkForUpdate();
    expect(result.kind).toBe("ready");
    expect(downloadAndInstallMock).toHaveBeenCalledTimes(1);
  });

  it("transitions to current when on latest version", async () => {
    checkMock.mockResolvedValue(null);
    const result = await checkForUpdate();
    expect(result.kind).toBe("current");
    expect(downloadAndInstallMock).not.toHaveBeenCalled();
  });

  it("returns ready immediately on second call (no re-download)", async () => {
    checkMock.mockResolvedValue(makeUpdate("0.2.6"));
    await checkForUpdate();
    checkMock.mockClear();
    downloadAndInstallMock.mockClear();
    const result = await checkForUpdate();
    expect(result.kind).toBe("ready");
    expect(checkMock).not.toHaveBeenCalled();
    expect(downloadAndInstallMock).not.toHaveBeenCalled();
  });

  it("coalesces concurrent callers into a single check + download", async () => {
    // Hold the plugin call open so the three callers all attach to the
    // same in-flight promise. Resolving once is enough for all three.
    let resolveCheck!: (u: any) => void;
    const checkPending = new Promise((r) => { resolveCheck = r; });
    checkMock.mockImplementation(() => checkPending);
    const a = checkForUpdate();
    const b = checkForUpdate();
    const c = checkForUpdate();
    // Flush microtasks so the IIFE has reached `await check()` before
    // we resolve. Without this, resolveCheck is still undefined.
    await Promise.resolve();
    await Promise.resolve();
    resolveCheck(makeUpdate("0.2.6"));
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toBe(rb);
    expect(rb).toBe(rc);
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(downloadAndInstallMock).toHaveBeenCalledTimes(1);
  });
});

describe("checkForUpdate — fallback path", () => {
  it("uses GitHub poll when plugin throws and surfaces fallback state", async () => {
    checkMock.mockRejectedValue(new Error("plugin offline"));
    httpFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v0.2.6" }),
    });
    const result = await checkForUpdate();
    expect(result.kind).toBe("fallback");
    if (result.kind === "fallback") expect(result.version).toBe("0.2.6");
  });

  it("returns current when both plugin and fallback yield no newer version", async () => {
    checkMock.mockRejectedValue(new Error("plugin offline"));
    httpFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v0.2.5" }),
    });
    const result = await checkForUpdate();
    expect(result.kind).toBe("current");
  });
});

describe("checkForUpdate — session safety", () => {
  it("defers when an active session was created within the staleness window", async () => {
    dbSelectMock.mockResolvedValue([{ cnt: 1 }]);
    checkMock.mockResolvedValue(null);
    const result = await checkForUpdate();
    expect(result.kind).toBe("idle");
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("force=true bypasses the deferral so manual check always runs", async () => {
    dbSelectMock.mockResolvedValue([{ cnt: 1 }]);
    checkMock.mockResolvedValue(null);
    const result = await checkForUpdate({ force: true });
    expect(result.kind).toBe("current");
    expect(checkMock).toHaveBeenCalled();
  });

  it("ignores stale processing rows so a crashed pulse can't permanently block updates", async () => {
    // The query selects only sessions with created_at > cutoff. Mock
    // returns 0 — meaning no recent active sessions even if old rows
    // exist with status='processing'.
    dbSelectMock.mockImplementation(async (sql: string) => {
      // Verify the query has the staleness guard
      expect(sql).toMatch(/created_at > /);
      return [{ cnt: 0 }];
    });
    checkMock.mockResolvedValue(null);
    const result = await checkForUpdate();
    expect(result.kind).toBe("current");
  });
});

describe("subscribe", () => {
  it("notifies subscribers of state transitions", async () => {
    const observed: string[] = [];
    const unsubscribe = subscribe((s) => observed.push(s.kind));
    checkMock.mockResolvedValue(makeUpdate("0.2.6"));
    await checkForUpdate();
    unsubscribe();
    // Initial idle, then checking, then ready.
    expect(observed).toEqual(["idle", "checking", "ready"]);
  });

  it("unsubscribe stops further updates", async () => {
    let count = 0;
    const unsub = subscribe(() => { count++; });
    unsub();
    checkMock.mockResolvedValue(null);
    await checkForUpdate();
    expect(count).toBe(1); // only the initial replay
  });
});

describe("getState", () => {
  it("starts at idle", () => {
    expect(getState().kind).toBe("idle");
  });
});
