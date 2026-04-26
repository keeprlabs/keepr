// Spawn-level tests: codex.complete (NDJSON usage parsing, output-last-message
// read), probeCodex (cache + classify), claudeCode signal handling. The Tauri
// shell, path, and fs plugins are all mocked so the tests run in jsdom without
// a real codex binary.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────
//
// vi.mock factories are hoisted above all imports, so the FakeCommand class
// must live inside vi.hoisted() to be available when the mock factory runs.

const harness = vi.hoisted(() => {
  type Listener = (data: any) => void;
  class FakeChild {
    pid = 12345;
    killed = false;
    onKill: (() => void) | null = null;
    async kill() {
      this.killed = true;
      this.onKill?.();
    }
    async write() {}
  }
  class FakeCommand {
    static lastInstance: FakeCommand | null = null;
    static lastChild: FakeChild | null = null;
    /** Resolves once the most recent spawn() call has returned its child —
     *  lets tests synchronize abort-after-spawn deterministically without
     *  setTimeout heuristics. */
    static spawned: Promise<FakeChild> = Promise.resolve(null as any);
    private static spawnedResolve: ((c: FakeChild) => void) | null = null;
    static plan: {
      stdout?: string[];
      stderr?: string[];
      exitCode?: number;
      spawnError?: string;
      holdOpen?: boolean;
    } = {};
    stdout = { _l: [] as Listener[], on(_e: string, fn: Listener) { (this as any)._l.push(fn); } };
    stderr = { _l: [] as Listener[], on(_e: string, fn: Listener) { (this as any)._l.push(fn); } };
    private _onClose: Listener | null = null;
    private _onError: Listener | null = null;
    constructor(public program: string, public args: string[]) {
      FakeCommand.lastInstance = this;
    }
    on(event: "close" | "error", fn: Listener) {
      if (event === "close") this._onClose = fn;
      if (event === "error") this._onError = fn;
    }
    async spawn() {
      if (FakeCommand.plan.spawnError) {
        const msg = FakeCommand.plan.spawnError;
        // Schedule the error event on next microtask so the caller's .catch
        // sees it after .spawn() rejects.
        queueMicrotask(() => this._onError?.(msg));
        throw new Error(msg);
      }
      const child = new FakeChild();
      FakeCommand.lastChild = child;
      FakeCommand.spawnedResolve?.(child);
      queueMicrotask(() => {
        for (const line of FakeCommand.plan.stdout || []) {
          this.stdout._l.forEach((l) => l(line));
        }
        for (const line of FakeCommand.plan.stderr || []) {
          this.stderr._l.forEach((l) => l(line));
        }
        if (!FakeCommand.plan.holdOpen) {
          this._onClose?.({ code: FakeCommand.plan.exitCode ?? 0, signal: null });
        } else {
          // Deterministic abort: when the test calls child.kill(), emit close
          // immediately via the onKill hook. No polling, no race.
          child.onKill = () => this._onClose?.({ code: null, signal: 9 });
        }
      });
      return child;
    }
    static create(program: string, args: string[] | string, _opts?: any) {
      FakeCommand.spawned = new Promise<FakeChild>((res) => {
        FakeCommand.spawnedResolve = res;
      });
      return new FakeCommand(program, Array.isArray(args) ? args : [args]);
    }
  }
  const fakeFiles = new Map<string, string>();
  return { FakeCommand, FakeChild, fakeFiles };
});

vi.mock("@tauri-apps/api/path", () => ({
  tempDir: vi.fn(async () => "/tmp"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn(async () => {}),
  writeTextFile: vi.fn(async (path: string, contents: string) => {
    harness.fakeFiles.set(path, contents);
  }),
  readTextFile: vi.fn(async (path: string) => {
    const v = harness.fakeFiles.get(path);
    if (v === undefined) throw new Error("ENOENT");
    return v;
  }),
  remove: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: harness.FakeCommand,
}));

const { FakeCommand, FakeChild, fakeFiles } = harness;

// ── System under test ────────────────────────────────────────────────

import {
  PROVIDERS,
  probeCodex,
  invalidateCodexProbe,
  _peekCodexProbeCache,
} from "../llm";

beforeEach(() => {
  fakeFiles.clear();
  invalidateCodexProbe();
  FakeCommand.plan = {};
  FakeCommand.lastInstance = null;
});

// ── Tests ────────────────────────────────────────────────────────────

describe("codex.complete", () => {
  it("returns text from --output-last-message and usage from NDJSON events", async () => {
    FakeCommand.plan = {
      stdout: [
        '{"type":"agent_message","msg":"thinking"}\n',
        '{"type":"task_complete","usage":{"input_tokens":42,"output_tokens":17}}\n',
      ],
      exitCode: 0,
    };
    // Pre-seed the file the provider is going to read.
    // We have to figure out the path codex.complete computed; easier: spy on
    // writeTextFile and use whatever path the provider asked for.
    // Codex.complete writes the file via the codex CLI — we have to write it
    // ourselves before the read. Hook into Command.spawn timing via the args.
    // Simpler approach: monkey-patch readTextFile for this test.
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("the answer is 42");

    const result = await PROVIDERS.codex.complete({
      model: "gpt-5",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.text).toBe("the answer is 42");
    expect(result.input_tokens).toBe(42);
    expect(result.output_tokens).toBe(17);
  });

  it("falls back to zero token counts when no usage event appears", async () => {
    FakeCommand.plan = {
      stdout: ['{"type":"agent_message","msg":"hi"}\n'],
      exitCode: 0,
    };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("hi");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await PROVIDERS.codex.complete({
      model: "gpt-5",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(result.text).toBe("hi");
    expect(result.input_tokens).toBe(0);
    expect(result.output_tokens).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("falls back to stdout when --output-last-message file is missing", async () => {
    FakeCommand.plan = {
      stdout: ['raw response text'],
      exitCode: 0,
    };
    // readTextFile rejects, simulating a missing file.

    const result = await PROVIDERS.codex.complete({
      model: "gpt-5",
      messages: [{ role: "user", content: "ping" }],
    });
    expect(result.text).toBe("raw response text");
  });

  it("throws on non-zero exit, surfacing stderr in the message", async () => {
    FakeCommand.plan = {
      stdout: [],
      stderr: ["some auth error"],
      exitCode: 1,
    };
    await expect(
      PROVIDERS.codex.complete({ model: "gpt-5", messages: [{ role: "user", content: "x" }] })
    ).rejects.toThrow(/some auth error/);
  });

  it("passes the hardening flags codex exec actually accepts (-s read-only, --skip-git-repo-check, --ephemeral, --json)", async () => {
    // codex v0.125 doesn't have `--ask-for-approval` on the exec subcommand
    // (exec is non-interactive by definition). It DOES require
    // `--skip-git-repo-check` when running outside a git repo, which our
    // hermetic tempdir is not. Regression: an earlier draft passed
    // `--ask-for-approval never` and the spawn failed at runtime with
    // "unexpected argument".
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("ok");
    await PROVIDERS.codex.complete({ model: "gpt-5", messages: [{ role: "user", content: "x" }] });
    const args = FakeCommand.lastInstance?.args || [];
    expect(args).toContain("-s");
    expect(args[args.indexOf("-s") + 1]).toBe("read-only");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--json");
    // Anti-regression: do NOT include the flag that doesn't exist.
    expect(args).not.toContain("--ask-for-approval");
  });

  it("aborts the spawn when opts.signal fires", async () => {
    FakeCommand.plan = { holdOpen: true };
    const ac = new AbortController();
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("never reached");
    const promise = PROVIDERS.codex.complete({
      model: "gpt-5",
      messages: [{ role: "user", content: "long" }],
      signal: ac.signal,
    });
    // Wait until the spawn has actually returned a child, then abort. This
    // exercises the post-spawn abort path deterministically — no setTimeout
    // racing the spawn microtask.
    await FakeCommand.spawned;
    ac.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts before spawn resolves still kills the child once it lands", async () => {
    FakeCommand.plan = { holdOpen: true };
    const ac = new AbortController();
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("never reached");
    // Abort BEFORE awaiting the call so the signal is already aborted when
    // runCli starts. Tests the early-fire abort path.
    ac.abort();
    await expect(
      PROVIDERS.codex.complete({
        model: "gpt-5",
        messages: [{ role: "user", content: "long" }],
        signal: ac.signal,
      })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("probeCodex", () => {
  it("ok: classifies clean exit as detected", async () => {
    FakeCommand.plan = { stdout: ['{"usage":{"input_tokens":1,"output_tokens":1}}\n'], exitCode: 0 };
    const r = await probeCodex();
    expect(r.ok).toBe(true);
  });

  it("not_installed: classifies 'command not found' on spawn", async () => {
    FakeCommand.plan = { spawnError: "codex: command not found" };
    const r = await probeCodex();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_installed");
  });

  it("not_signed_in: classifies auth-related stderr", async () => {
    FakeCommand.plan = { stdout: [], stderr: ["Not signed in. Run `codex login`."], exitCode: 1 };
    const r = await probeCodex();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_signed_in");
  });

  it("other: any other failure falls through", async () => {
    FakeCommand.plan = { stdout: [], stderr: ["random network blip"], exitCode: 1 };
    const r = await probeCodex();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("other");
  });

  it("caches across calls — second invocation does not spawn", async () => {
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    await probeCodex();
    const firstSpawn = FakeCommand.lastInstance;

    await probeCodex();
    // No new instance was created.
    expect(FakeCommand.lastInstance).toBe(firstSpawn);
  });

  it("force=true bypasses cache and re-spawns", async () => {
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    await probeCodex();
    const firstSpawn = FakeCommand.lastInstance;

    await probeCodex(true);
    expect(FakeCommand.lastInstance).not.toBe(firstSpawn);
  });

  it("invalidateCodexProbe clears the cache", async () => {
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    await probeCodex();
    expect(_peekCodexProbeCache()).not.toBeNull();
    invalidateCodexProbe();
    expect(_peekCodexProbeCache()).toBeNull();
  });

  it("dedupes concurrent in-flight probes — only one spawn", async () => {
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    const [a, b, c] = await Promise.all([probeCodex(), probeCodex(), probeCodex()]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(c.ok).toBe(true);
  });
});

describe("runCli settle discipline [regression: double-settle bug]", () => {
  // Tauri's shell plugin can fire both `error` and `close` for the same child
  // (some spawn-failure paths emit both). Without the `settled` flag, the
  // Promise would settle twice and the later settle would silently overwrite
  // the first — masking a real error with a "0-exit success".
  it("first event wins: error before close → reject with the error, not the exit code", async () => {
    const planErr = "synthetic spawn error";
    // Replace spawn with one that fires error THEN close (both microtasks
    // scheduled in order so first-scheduled-runs-first is deterministic).
    const origSpawn = FakeCommand.prototype.spawn;
    FakeCommand.prototype.spawn = async function (this: any) {
      const child = new FakeChild();
      // Fire error first, then a clean close. Without settle discipline, the
      // Promise would resolve with exit code 0 instead of rejecting.
      queueMicrotask(() => this._onError?.(planErr));
      queueMicrotask(() => this._onClose?.({ code: 0, signal: null }));
      return child;
    };

    try {
      await expect(
        PROVIDERS["claude-code"].complete({
          model: "claude-haiku-4-5-20251001",
          messages: [{ role: "user", content: "x" }],
        })
      ).rejects.toThrow(/synthetic spawn error/);
    } finally {
      FakeCommand.prototype.spawn = origSpawn;
    }
  });

  it("first event wins: close before error → resolve with the exit code, no late reject", async () => {
    // The opposite race. The Promise should resolve via close; the late
    // error must be dropped, not flip the result.
    const origSpawn = FakeCommand.prototype.spawn;
    FakeCommand.prototype.spawn = async function (this: any) {
      const child = new FakeChild();
      this.stdout._l.forEach((l: any) =>
        l('{"result":"hello","usage":{"input_tokens":1,"output_tokens":1}}')
      );
      queueMicrotask(() => this._onClose?.({ code: 0, signal: null }));
      queueMicrotask(() => this._onError?.("late noise"));
      return child;
    };

    try {
      const r = await PROVIDERS["claude-code"].complete({
        model: "claude-haiku-4-5-20251001",
        messages: [{ role: "user", content: "x" }],
      });
      expect(r.text).toBe("hello");
    } finally {
      FakeCommand.prototype.spawn = origSpawn;
    }
  });
});

describe("pickUsageFromCodexEvents", () => {
  it("prefers task_complete events over earlier usage events", async () => {
    FakeCommand.plan = {
      stdout: [
        '{"type":"agent_message","usage":{"input_tokens":1,"output_tokens":1}}\n',
        '{"type":"task_complete","usage":{"input_tokens":99,"output_tokens":33}}\n',
      ],
      exitCode: 0,
    };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("done");
    const r = await PROVIDERS.codex.complete({
      model: "gpt-5",
      messages: [{ role: "user", content: "x" }],
    });
    expect(r.input_tokens).toBe(99);
    expect(r.output_tokens).toBe(33);
  });

  it("doesn't get fooled by 0 ?? 42 — picks the first positive value", async () => {
    FakeCommand.plan = {
      stdout: [
        // input_tokens=0 alongside prompt_tokens=42 — the bug was nullish
        // coalescing returning 0 instead of 42.
        '{"type":"task_complete","usage":{"input_tokens":0,"prompt_tokens":42,"output_tokens":7}}\n',
      ],
      exitCode: 0,
    };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("done");
    const r = await PROVIDERS.codex.complete({
      model: "gpt-5",
      messages: [{ role: "user", content: "x" }],
    });
    expect(r.input_tokens).toBe(42);
    expect(r.output_tokens).toBe(7);
  });
});

describe("classifyCliError extended patterns", () => {
  it("classifies HTTP 401 stderr as not_signed_in", async () => {
    FakeCommand.plan = { stdout: [], stderr: ["server returned 401"], exitCode: 1 };
    const r = await probeCodex();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_signed_in");
  });

  it("classifies forbidden as not_signed_in", async () => {
    FakeCommand.plan = { stdout: [], stderr: ["403 forbidden"], exitCode: 1 };
    const r = await probeCodex();
    if (!r.ok) expect(r.reason).toBe("not_signed_in");
  });

  it("classifies token expired as not_signed_in", async () => {
    FakeCommand.plan = { stdout: [], stderr: ["token expired"], exitCode: 1 };
    const r = await probeCodex();
    if (!r.ok) expect(r.reason).toBe("not_signed_in");
  });

  it("classifies 'program not allowed' (Tauri capability denial) as not_installed", async () => {
    FakeCommand.plan = { spawnError: "program not allowed: codex" };
    const r = await probeCodex();
    if (!r.ok) expect(r.reason).toBe("not_installed");
  });
});

describe("claudeCode signal handling [regression: previously ignored opts.signal]", () => {
  it("aborts the spawn when opts.signal fires mid-flight", async () => {
    FakeCommand.plan = { holdOpen: true };
    const ac = new AbortController();
    const promise = PROVIDERS["claude-code"].complete({
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: "long" }],
      signal: ac.signal,
    });
    await FakeCommand.spawned;
    ac.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("happy path: returns parsed JSON with usage when exit code is 0", async () => {
    FakeCommand.plan = {
      stdout: ['{"result":"hi","usage":{"input_tokens":3,"output_tokens":1}}'],
      exitCode: 0,
    };
    const result = await PROVIDERS["claude-code"].complete({
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: "ping" }],
    });
    expect(result.text).toBe("hi");
    expect(result.input_tokens).toBe(3);
    expect(result.output_tokens).toBe(1);
  });
});
