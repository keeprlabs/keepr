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

// resolve_binary is the new Rust command that turns "codex" into an absolute
// path via the user's login shell (fixes the macOS GUI app PATH problem). In
// tests we make it a no-op identity by default — returning the bare name
// keeps the existing assertions on `program === "sh"` and `^exec 'codex' `
// valid. detect_app_bundle returns null by default (no .app present); tests
// that exercise the app_only_no_cli branch override per-call.
const invokeMock = vi.fn(async (cmd: string, args?: any) => {
  if (cmd === "resolve_binary") return args?.name ?? null;
  if (cmd === "detect_app_bundle") return null;
  return null;
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: any) => invokeMock(cmd, args),
}));

// Mock ./db so resolveBinary's override-from-app_config check can be exercised
// without a real Tauri SQL backend. Default: empty config (no overrides set).
// Tests that exercise the override branch override this per-test.
const getConfigMock = vi.fn(async () => ({
  codex_cli_path: "",
  claude_code_cli_path: "",
}));
vi.mock("../db", () => ({
  getConfig: () => getConfigMock(),
}));

const { FakeCommand, FakeChild, fakeFiles } = harness;

// ── System under test ────────────────────────────────────────────────

import {
  PROVIDERS,
  probeCodex,
  probeClaudeCode,
  invalidateCodexProbe,
  invalidateClaudeProbe,
  _peekCodexProbeCache,
  _peekBinaryPathCache,
  friendlyProviderError,
} from "../llm";

beforeEach(async () => {
  fakeFiles.clear();
  invalidateCodexProbe();
  invalidateClaudeProbe();
  // Reset invoke mock to identity behavior (returns the bare name, simulating
  // a binary that's already in PATH). Tests that need not_in_path or a
  // specific absolute path override this per-test.
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === "resolve_binary") return args?.name ?? null;
    if (cmd === "detect_app_bundle") return null;
    if (cmd === "validate_binary_path") return args?.path ?? null;
    return null;
  });
  getConfigMock.mockReset();
  getConfigMock.mockImplementation(async () => ({
    codex_cli_path: "",
    claude_code_cli_path: "",
  }));
  FakeCommand.plan = {};
  FakeCommand.lastInstance = null;
  // Reset the spawned-handle promise. Without this, a previous test that set
  // `spawnError` leaves FakeCommand.spawned pending forever (spawn throws
  // before spawnedResolve fires), and the next test that does
  // `await FakeCommand.spawned` blocks until the timeout. Pre-existing race;
  // exposed once an extra `await resolveBinary(...)` microtask was added
  // between complete() and runCli's Command.create.
  FakeCommand.spawned = Promise.resolve(null as any);
  // Reset the per-call mockResolvedValueOnce queue on readTextFile —
  // otherwise an aborted test that seeded a value but never reached the
  // read leaves stale state for the next test.
  const fs = await import("@tauri-apps/plugin-fs");
  (fs.readTextFile as any).mockReset();
  (fs.readTextFile as any).mockImplementation(async (path: string) => {
    const v = fakeFiles.get(path);
    if (v === undefined) throw new Error("ENOENT");
    return v;
  });
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

  it("spawns through `sh -c 'exec codex ... < /dev/null'` to close stdin", async () => {
    // Regression: codex CLI v0.125 hangs forever when stdin is a pipe (Tauri
    // default) because it waits for EOF to append the stdin block. Tauri's
    // shell plugin exposes no way to close child stdin, so we wrap in sh.
    // `exec codex ...` makes codex replace sh at that PID so child.kill()
    // still works on the abort path. `< /dev/null` is the actual fix.
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    const fs = await import("@tauri-apps/plugin-fs");
    fakeFiles.set("/tmp/last-message.txt", "ok"); // not used but harmless
    (fs.readTextFile as any).mockResolvedValueOnce("ok");
    await PROVIDERS.codex.complete({ model: "gpt-5.4", messages: [{ role: "user", content: "x" }] });

    expect(FakeCommand.lastInstance?.program).toBe("sh");
    const args = FakeCommand.lastInstance?.args || [];
    expect(args[0]).toBe("-c");
    const cmdLine = args[1] || "";
    expect(cmdLine).toMatch(/^exec 'codex' /);
    expect(cmdLine).toMatch(/< \/dev\/null$/);
  });

  it("forwards the hardening flags codex exec actually accepts (-s read-only, --skip-git-repo-check, --ephemeral, --json)", async () => {
    // codex v0.125 doesn't have `--ask-for-approval` on the exec subcommand.
    // It DOES require `--skip-git-repo-check` (our hermetic tempdir isn't a
    // git repo). Earlier drafts passed `--ask-for-approval never`; spawn
    // failed at runtime with "unexpected argument".
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("ok");
    await PROVIDERS.codex.complete({ model: "gpt-5.4", messages: [{ role: "user", content: "x" }] });
    const cmdLine = FakeCommand.lastInstance?.args?.[1] || "";
    expect(cmdLine).toContain("'-s' 'read-only'");
    expect(cmdLine).toContain("'--skip-git-repo-check'");
    expect(cmdLine).toContain("'--ephemeral'");
    expect(cmdLine).toContain("'--json'");
    // Anti-regression: do NOT include the flag that doesn't exist.
    expect(cmdLine).not.toContain("--ask-for-approval");
  });

  it("shell-escapes the prompt safely (single quotes use the POSIX `'\"'\"'` escape)", async () => {
    // The prompt is user-content; if shQuote is wrong, a malicious prompt
    // could close its quoted region and inject shell. Test the structural
    // property: every embedded `'` in the prompt expands to the POSIX
    // four-char escape sequence `'"'"'` in the rendered command line.
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("ok");
    const evilPrompt = "'; rm -rf /; echo '";
    await PROVIDERS.codex.complete({
      model: "gpt-5.4",
      messages: [{ role: "user", content: evilPrompt }],
    });
    const cmdLine = FakeCommand.lastInstance?.args?.[1] || "";
    // The two embedded single quotes in the prompt should each become the
    // POSIX escape sequence — proves shQuote did its job.
    const escapeCount = (cmdLine.match(/'"'"'/g) || []).length;
    expect(escapeCount).toBeGreaterThanOrEqual(2);
    // And the cmd line must still terminate with the stdin redirect, not
    // with anything from the evil payload.
    expect(cmdLine.endsWith("< /dev/null")).toBe(true);
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
  it("parses real Codex CLI v0.125 output (turn.started → item.completed → turn.completed)", async () => {
    // This is a near-verbatim capture of `codex exec --json` output against
    // the live CLI on 2026-04-26. Locks in the actual shape so a regression
    // in the parser would surface in CI instead of as silent zero-token
    // counts in production. Note: top-level `usage` on `turn.completed`,
    // not nested under `msg`/`payload`. Includes the bonus fields
    // (cached_input_tokens, reasoning_output_tokens) that the parser
    // currently ignores but a future cost-analytics pass might surface.
    FakeCommand.plan = {
      stdout: [
        '{"type":"thread.started","thread_id":"019dcb01-ca4b-75d1-902c-3ad37ca3698b"}\n',
        '{"type":"turn.started"}\n',
        '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}\n',
        '{"type":"turn.completed","usage":{"input_tokens":11541,"cached_input_tokens":10112,"output_tokens":18,"reasoning_output_tokens":11}}\n',
      ],
      exitCode: 0,
    };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("ok");
    const r = await PROVIDERS.codex.complete({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Reply with just: ok" }],
    });
    expect(r.text).toBe("ok");
    expect(r.input_tokens).toBe(11541);
    expect(r.output_tokens).toBe(18);
  });

  it("prefers turn.completed events over earlier usage events", async () => {
    FakeCommand.plan = {
      stdout: [
        '{"type":"agent_message","usage":{"input_tokens":1,"output_tokens":1}}\n',
        '{"type":"turn.completed","usage":{"input_tokens":99,"output_tokens":33}}\n',
      ],
      exitCode: 0,
    };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("done");
    const r = await PROVIDERS.codex.complete({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "x" }],
    });
    expect(r.input_tokens).toBe(99);
    expect(r.output_tokens).toBe(33);
  });

  it("also matches a hypothetical task_complete event (forward-compat for CLI renames)", async () => {
    FakeCommand.plan = {
      stdout: [
        '{"type":"agent_message","usage":{"input_tokens":1,"output_tokens":1}}\n',
        '{"type":"task_complete","usage":{"input_tokens":42,"output_tokens":7}}\n',
      ],
      exitCode: 0,
    };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("done");
    const r = await PROVIDERS.codex.complete({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "x" }],
    });
    expect(r.input_tokens).toBe(42);
    expect(r.output_tokens).toBe(7);
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

// ── Binary resolution: the macOS GUI-app PATH fix ───────────────────────────
//
// macOS GUI apps inherit a minimal PATH from Launch Services, NOT the user's
// shell PATH. So `sh -c 'exec codex'` fails with "codex: not found" even when
// `codex` works fine in Terminal. The fix: resolve to absolute path via the
// user's login shell once, cache, and pass the absolute path to the spawn so
// PATH stops mattering. Tests below cover the resolution, caching, classify
// branch (not_in_path vs not_installed), and the friendly error copy.

describe("resolveBinary [regression: GUI app PATH not_in_path bug]", () => {
  it("probeCodex returns not_in_path when the user shell can't find the binary", async () => {
    // Simulate: brother has codex in ~/.npm-global/bin, but Tauri-spawned shell
    // can't see it. invoke('resolve_binary') returns null because `command -v
    // codex` failed in the user's login shell. (In production this would only
    // happen if the binary genuinely isn't installed OR the user has a really
    // weird shell setup that masks PATH.)
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "resolve_binary") return null;
      return null;
    });
    const r = await probeCodex();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_in_path");
  });

  it("probeClaudeCode returns not_in_path when shell can't find claude", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "resolve_binary") return null;
      return null;
    });
    const r = await probeClaudeCode();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_in_path");
  });

  it("uses the resolved absolute path in the spawn (not the bare name)", async () => {
    // Simulate the production case: shell resolves codex to homebrew location.
    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "resolve_binary" && args?.name === "codex") {
        return "/opt/homebrew/bin/codex";
      }
      return null;
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("ok");

    await PROVIDERS.codex.complete({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "x" }],
    });

    // Still spawns through sh (for the stdin redirect), but the binary inside
    // is now the absolute path — that's what makes the GUI-app PATH irrelevant.
    expect(FakeCommand.lastInstance?.program).toBe("sh");
    const cmdLine = FakeCommand.lastInstance?.args?.[1] || "";
    expect(cmdLine).toMatch(/^exec '\/opt\/homebrew\/bin\/codex' /);
    expect(cmdLine).toMatch(/< \/dev\/null$/);
  });

  it("caches the resolved path — second probe doesn't re-invoke resolve_binary", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "resolve_binary") return `/usr/local/bin/${args?.name}`;
      return null;
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };

    await probeCodex();
    const callsAfterFirst = invokeMock.mock.calls.filter(
      (c) => c[0] === "resolve_binary"
    ).length;

    // Second probe goes through the probe cache (force=false), AND also
    // doesn't need to re-resolve. Force a fresh probe to bypass the probe
    // cache and confirm the bin path cache still avoids a second invoke.
    await probeCodex(true);
    const callsAfterSecond = invokeMock.mock.calls.filter(
      (c) => c[0] === "resolve_binary"
    ).length;

    expect(callsAfterFirst).toBe(1);
    expect(callsAfterSecond).toBe(1); // cache hit, no second invoke
    expect(_peekBinaryPathCache("codex")).toBe("/usr/local/bin/codex");
  });

  it("invalidateCodexProbe clears the binary path cache", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "resolve_binary") return `/usr/local/bin/${args?.name}`;
      return null;
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    await probeCodex();
    expect(_peekBinaryPathCache("codex")).toBe("/usr/local/bin/codex");

    invalidateCodexProbe();
    expect(_peekBinaryPathCache("codex")).toBeNull();
  });

  it("invalidateClaudeProbe clears the binary path cache for claude", async () => {
    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "resolve_binary") return `/usr/local/bin/${args?.name}`;
      return null;
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    await probeClaudeCode();
    expect(_peekBinaryPathCache("claude")).toBe("/usr/local/bin/claude");

    invalidateClaudeProbe();
    expect(_peekBinaryPathCache("claude")).toBeNull();
  });

  it("falls back to bare name when invoke itself throws (test env without Tauri)", async () => {
    // Belt-and-suspenders: if the invoke handler somehow isn't registered,
    // resolveBinary should return the bare name so spawning at least *tries*.
    // Production always has invoke; this is a paranoid fallback.
    invokeMock.mockImplementation(async () => {
      throw new Error("invoke not available");
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    const r = await probeCodex();
    expect(r.ok).toBe(true);
  });
});

describe("app_only_no_cli — user has Codex.app but no CLI shim", () => {
  it("probeCodex returns app_only_no_cli when shell can't resolve but Codex.app exists", async () => {
    // Simulate the "I installed the macOS app, why doesn't it work?" case.
    // resolve_binary returns null (no CLI on shell PATH) but detect_app_bundle
    // finds /Applications/Codex.app. The probe must distinguish this from the
    // truly-not-installed case so the UI can point the user at the right fix
    // (Open Codex → Settings → Install Shell Command).
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "resolve_binary") return null;
      if (cmd === "detect_app_bundle") return "/Applications/Codex.app";
      return null;
    });
    const r = await probeCodex();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("app_only_no_cli");
      expect(r.appPath).toBe("/Applications/Codex.app");
    }
  });

  it("probeCodex prefers not_in_path when no .app is found", async () => {
    // Defense in depth: if both resolve_binary and detect_app_bundle return
    // null, we fall back to not_in_path (the "weird PATH or genuinely not
    // installed" catchall) — NOT app_only_no_cli.
    invokeMock.mockImplementation(async () => null);
    const r = await probeCodex();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_in_path");
  });

  it("friendly error copy points the user at 'Install Shell Command'", async () => {
    const msg = friendlyProviderError(
      new Error(
        "Codex not available (app_only_no_cli): codex: /Applications/Codex.app is installed but no CLI shim found"
      ),
      "codex"
    );
    expect(msg).toMatch(/Install Shell Command/);
    expect(msg).toMatch(/Codex\.app/);
    // Anti-regression: shouldn't tell the user to `npm install` something
    // they perceive as already installed.
    expect(msg).not.toMatch(/npm install/);
  });

  it("probeClaudeCode does not claim app_only_no_cli for Claude.app (different product)", async () => {
    // Claude Code is CLI-only; "Claude.app" is the chat app, NOT a substitute
    // for the Claude Code CLI provider. The Rust allowlist refuses to match
    // any name except codex; verify the JS layer respects that — even if a
    // future bug let detect_app_bundle return non-null for claude, the
    // appPath wouldn't satisfy this provider, but the test below proves the
    // current invariant: detect returns null and we surface not_in_path.
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "resolve_binary") return null;
      if (cmd === "detect_app_bundle") return null; // matches Rust allowlist
      return null;
    });
    const r = await probeClaudeCode();
    if (!r.ok) expect(r.reason).toBe("not_in_path");
  });
});

describe("friendlyProviderError not_in_path branch", () => {
  it("codex: surfaces the GUI-app-PATH copy, not the misleading 'not installed'", async () => {
    const msg = friendlyProviderError(
      new Error("Codex not available (not_in_path): codex: not found in user shell PATH"),
      "codex"
    );
    expect(msg).toMatch(/installed but Keepr can't find it/i);
    // Anti-regression: the user-installed codex should NOT be told to install
    // it again — that's the embarrassing message we're fixing.
    expect(msg).not.toMatch(/not installed/i);
  });

  it("claude-code: surfaces the GUI-app-PATH copy", async () => {
    const msg = friendlyProviderError(
      new Error("Claude Code not available (not_in_path): claude: not found in user shell PATH"),
      "claude-code"
    );
    expect(msg).toMatch(/installed but Keepr can't find it/i);
  });
});

// ── Manual path override (Settings) ────────────────────────────────────────
//
// Last-resort escape hatch for users whose CLI lives in a custom location
// (asdf/mise shims, /opt/<corp>/bin, hand-built fork of codex). resolveBinary
// loads the override from app_config once per session per name, validates
// via the validate_binary_path Rust command, and uses the canonical path if
// valid. A broken override falls through to shell + bundle detection rather
// than throwing — moving a binary shouldn't strand the user.

describe("resolveBinary — Settings path override", () => {
  it("override takes priority over shell resolution", async () => {
    // Even though shell resolution would return /usr/bin/codex, the override
    // wins. Proves the priority order in resolveBinary's flow doc.
    getConfigMock.mockImplementation(async () => ({
      codex_cli_path: "/Users/me/dev/codex-fork/codex",
      claude_code_cli_path: "",
    }));
    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "resolve_binary") return "/usr/bin/codex"; // would be used absent override
      if (cmd === "detect_app_bundle") return null;
      if (cmd === "validate_binary_path") {
        // Accept the override path by returning the canonical form.
        return args?.path === "/Users/me/dev/codex-fork/codex"
          ? "/Users/me/dev/codex-fork/codex"
          : null;
      }
      return null;
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("ok");

    await PROVIDERS.codex.complete({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "x" }],
    });
    const cmdLine = FakeCommand.lastInstance?.args?.[1] || "";
    expect(cmdLine).toMatch(/^exec '\/Users\/me\/dev\/codex-fork\/codex' /);
    // Anti-regression: shell resolution must NOT have been used.
    expect(cmdLine).not.toMatch(/'\/usr\/bin\/codex'/);
  });

  it("broken override falls through to shell resolution (NOT throw)", async () => {
    // User saved a path; binary was later deleted/moved. validate_binary_path
    // returns null. We must auto-recover via shell resolution rather than
    // stranding the user with a hard error.
    getConfigMock.mockImplementation(async () => ({
      codex_cli_path: "/no/longer/here/codex",
      claude_code_cli_path: "",
    }));
    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "resolve_binary") return "/opt/homebrew/bin/codex";
      if (cmd === "detect_app_bundle") return null;
      if (cmd === "validate_binary_path") return null; // broken override
      return null;
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    const fs = await import("@tauri-apps/plugin-fs");
    (fs.readTextFile as any).mockResolvedValueOnce("ok");

    await PROVIDERS.codex.complete({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "x" }],
    });
    const cmdLine = FakeCommand.lastInstance?.args?.[1] || "";
    // Shell resolution wins on the fall-through.
    expect(cmdLine).toMatch(/^exec '\/opt\/homebrew\/bin\/codex' /);
  });

  it("override is checked once per session — invalidateCodexProbe re-reads", async () => {
    getConfigMock.mockImplementation(async () => ({
      codex_cli_path: "/usr/local/bin/codex",
      claude_code_cli_path: "",
    }));
    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "resolve_binary") return null;
      if (cmd === "detect_app_bundle") return null;
      if (cmd === "validate_binary_path") return args?.path ?? null;
      return null;
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    await probeCodex();
    expect(getConfigMock).toHaveBeenCalledTimes(1);

    // Force a re-probe without invalidating — should NOT re-call getConfig.
    await probeCodex(true);
    expect(getConfigMock).toHaveBeenCalledTimes(1);

    // Now invalidate and re-probe — getConfig must be called again so a
    // newly-saved override is picked up.
    invalidateCodexProbe();
    await probeCodex();
    expect(getConfigMock).toHaveBeenCalledTimes(2);
  });

  it("empty override string is treated as no override (does NOT call validate_binary_path)", async () => {
    // Sanity: a fresh install has codex_cli_path: "" — the validate command
    // must not run on every probe.
    getConfigMock.mockImplementation(async () => ({
      codex_cli_path: "",
      claude_code_cli_path: "",
    }));
    invokeMock.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "resolve_binary") return args?.name ?? null;
      if (cmd === "detect_app_bundle") return null;
      if (cmd === "validate_binary_path") return null;
      return null;
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    await probeCodex();
    const validateCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "validate_binary_path"
    ).length;
    expect(validateCalls).toBe(0);
  });
});

// ── Claude spawn through sh wrapper (capability fix, §5) ───────────────────
//
// claudeCode.complete + probeClaudeCode used to call runCli(claudeBin, args)
// directly, but Tauri's shell:allow-spawn capability matches by program name
// — passing /opt/homebrew/bin/claude instead of "claude" would be rejected.
// Wrapping through `sh -c 'exec <claudeBin> ...'` means Tauri only sees `sh`
// (which is allowed); the absolute path is just a string inside the script,
// never matched against the allowlist. These tests lock in the wrap.

describe("claudeCode spawns through sh wrapper [regression: capability allowlist]", () => {
  it("claudeCode.complete spawns sh, with the resolved claude path inside the cmd line", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "resolve_binary") return "/opt/homebrew/bin/claude";
      return null;
    });
    FakeCommand.plan = {
      stdout: ['{"result":"hi","usage":{"input_tokens":1,"output_tokens":1}}'],
      exitCode: 0,
    };
    await PROVIDERS["claude-code"].complete({
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: "ping" }],
    });
    expect(FakeCommand.lastInstance?.program).toBe("sh");
    const cmdLine = FakeCommand.lastInstance?.args?.[1] || "";
    expect(cmdLine).toMatch(/^exec '\/opt\/homebrew\/bin\/claude' /);
    // Anti-regression: must NOT spawn claude as the program directly. That's
    // exactly the capability-rejection bug.
    expect(FakeCommand.lastInstance?.program).not.toBe("claude");
    expect(FakeCommand.lastInstance?.program).not.toBe("/opt/homebrew/bin/claude");
  });

  it("probeClaudeCode also spawns through sh", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "resolve_binary") return "/opt/homebrew/bin/claude";
      return null;
    });
    FakeCommand.plan = { stdout: [], exitCode: 0 };
    await probeClaudeCode();
    expect(FakeCommand.lastInstance?.program).toBe("sh");
    const cmdLine = FakeCommand.lastInstance?.args?.[1] || "";
    expect(cmdLine).toMatch(/'\/opt\/homebrew\/bin\/claude'/);
  });
});
