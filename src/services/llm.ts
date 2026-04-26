// Multi-provider LLM layer. Thin interface so workflows don't care which
// provider is active. Defaults to Anthropic; OpenAI and OpenRouter are
// drop-in alternatives.

import { fetch } from "@tauri-apps/plugin-http";
import { Command } from "@tauri-apps/plugin-shell";
import { tempDir, join } from "@tauri-apps/api/path";
import { writeTextFile, readTextFile, remove, mkdir } from "@tauri-apps/plugin-fs";
import { SECRET_KEYS, getSecret } from "./secrets";

export type LLMProviderId = "anthropic" | "openai" | "openrouter" | "custom" | "claude-code" | "codex";

export type LLMCategory = "hosted" | "cli" | "self_hosted";

/** CLI metadata for providers that detect a local binary instead of using an
 *  API key. Consumed by CliProviderPanel to render install / login help and
 *  the click-to-copy command for the not-signed-in error state. */
export interface CliProviderMeta {
  /** Shell command to install the CLI (e.g. "brew install codex"). */
  installCmd?: string;
  /** URL to the install instructions / repo (e.g. "github.com/openai/codex"). */
  installUrl?: string;
  /** Shell command to authenticate (e.g. "codex login"). Click-to-copy. */
  loginCmd?: string;
}

/** Result of probing a CLI-detected provider. The `reason` discriminator lets
 *  the UI render a specific help block (install vs. login) instead of a
 *  generic "failed" message. */
export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: "not_installed" | "not_signed_in" | "other"; raw: string };

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCallOptions {
  model: string;
  system?: string;
  messages: LLMMessage[];
  temperature?: number;
  max_tokens?: number;
  // Override the keychain-stored key. Used by the onboarding test call
  // so we can verify a key BEFORE persisting it, and avoid a keychain
  // roundtrip on the same tick (macOS can return stale on get-after-set
  // in unsigned dev builds).
  keyOverride?: string;
  // Cancellation from the run overlay. When aborted, the underlying
  // fetch() call is cancelled and throws a DOMException('AbortError'),
  // which the pipeline catches and translates into a session delete.
  signal?: AbortSignal;
}

export interface LLMCallResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
}

export interface LLMProvider {
  id: LLMProviderId;
  category: LLMCategory;
  label: string;
  keyUrl: string;
  defaultSynthesisModel: string;
  defaultClassifierModel: string;
  /** Set on CLI-detected providers (claude-code, codex). Drives the
   *  CliProviderPanel install / login help blocks. */
  cli?: CliProviderMeta;
  complete(opts: LLMCallOptions): Promise<LLMCallResult>;
  test(keyOverride?: string): Promise<boolean>;
}

/** Runtime config for the custom provider, loaded from app_config. */
export interface CustomProviderConfig {
  base_url: string;
  synthesis_model: string;
  classifier_model: string;
}

let _customConfig: CustomProviderConfig | null = null;

export function setCustomConfig(cfg: CustomProviderConfig) {
  _customConfig = cfg;
}

export function getCustomConfig(): CustomProviderConfig | null {
  return _customConfig;
}

// ---- Anthropic -----------------------------------------------------------

const anthropic: LLMProvider = {
  id: "anthropic",
  category: "hosted",
  label: "Anthropic",
  keyUrl: "https://platform.claude.com/settings/keys",
  defaultSynthesisModel: "claude-sonnet-4-6",
  defaultClassifierModel: "claude-haiku-4-5-20251001",

  async complete(opts) {
    const key = opts.keyOverride || (await getSecret(SECRET_KEYS.anthropic));
    if (!key) throw new Error("No Anthropic API key");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        // Tauri's HTTP plugin forwards an Origin header from the webview,
        // so Anthropic treats the call as a direct-from-browser request
        // and requires this opt-in header. For a local Tauri desktop app
        // the key lives in the OS keychain and is never exposed to any
        // browser origin, so this is safe.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.max_tokens ?? 4096,
        temperature: opts.temperature ?? 0.2,
        system: opts.system,
        messages: opts.messages.map((m) => ({
          role: m.role === "system" ? "user" : m.role,
          content: m.content,
        })),
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const text =
      (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n") || "";
    return {
      text,
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
    };
  },

  async test(keyOverride?: string) {
    // Propagate errors so the caller can translate 401/429/network/scope
    // messages via friendlyProviderError. Silently returning false loses
    // the actual reason the key failed. keyOverride lets the onboarding
    // flow verify a key before persisting it to the keychain.
    await this.complete({
      model: this.defaultClassifierModel,
      messages: [{ role: "user", content: "Reply with just: ok" }],
      max_tokens: 10,
      keyOverride,
    });
    return true;
  },
};

// ---- OpenAI --------------------------------------------------------------

const openai: LLMProvider = {
  id: "openai",
  category: "hosted",
  label: "OpenAI",
  keyUrl: "https://platform.openai.com/api-keys",
  defaultSynthesisModel: "gpt-4o",
  defaultClassifierModel: "gpt-4o-mini",

  async complete(opts) {
    const key = opts.keyOverride || (await getSecret(SECRET_KEYS.openai));
    if (!key) throw new Error("No OpenAI API key");
    const msgs: LLMMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    msgs.push(...opts.messages);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.max_tokens ?? 4096,
        messages: msgs,
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
    }
    const data: any = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    };
  },

  async test(keyOverride?: string) {
    await this.complete({
      model: this.defaultClassifierModel,
      messages: [{ role: "user", content: "Reply with just: ok" }],
      max_tokens: 10,
      keyOverride,
    });
    return true;
  },
};

// ---- OpenRouter ----------------------------------------------------------

const openrouter: LLMProvider = {
  id: "openrouter",
  category: "hosted",
  label: "OpenRouter",
  keyUrl: "https://openrouter.ai/keys",
  defaultSynthesisModel: "anthropic/claude-sonnet-4.6",
  defaultClassifierModel: "anthropic/claude-haiku-4.5",

  async complete(opts) {
    const key = opts.keyOverride || (await getSecret(SECRET_KEYS.openrouter));
    if (!key) throw new Error("No OpenRouter API key");
    const msgs: LLMMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    msgs.push(...opts.messages);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "HTTP-Referer": "https://keepr.app",
        "X-Title": "Keepr",
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.max_tokens ?? 4096,
        messages: msgs,
      }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 300)}`);
    }
    const data: any = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    };
  },

  async test(keyOverride?: string) {
    await this.complete({
      model: this.defaultClassifierModel,
      messages: [{ role: "user", content: "Reply with just: ok" }],
      max_tokens: 10,
      keyOverride,
    });
    return true;
  },
};

// ---- Custom (OpenAI-compatible) -------------------------------------------

const custom: LLMProvider = {
  id: "custom",
  // Categorized as "hosted" until a second self-hosted provider exists; see
  // TODOS.md → "Split self_hosted as a third visible category in the LLM picker".
  category: "hosted",
  label: "Custom",
  keyUrl: "", // no dashboard — user provides their own
  defaultSynthesisModel: "default",
  defaultClassifierModel: "default",

  async complete(opts) {
    const cfg = _customConfig;
    if (!cfg?.base_url) throw new Error("Custom provider not configured — set a base URL in Settings.");
    const key = opts.keyOverride || (await getSecret(SECRET_KEYS.custom));
    const url = cfg.base_url.replace(/\/+$/, "") + "/v1/chat/completions";
    const msgs: LLMMessage[] = [];
    if (opts.system) msgs.push({ role: "system", content: opts.system });
    msgs.push(...opts.messages);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (key) headers["Authorization"] = `Bearer ${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.max_tokens ?? 4096,
        messages: msgs,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Custom endpoint ${res.status}: ${t.slice(0, 300)}`);
    }
    const data: any = await res.json();
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    };
  },

  async test(keyOverride?: string) {
    await this.complete({
      model: _customConfig?.classifier_model || "default",
      messages: [{ role: "user", content: "Reply with just: ok" }],
      max_tokens: 10,
      keyOverride,
    });
    return true;
  },
};

// ---- CLI spawn helper -----------------------------------------------------

/** Match what fetch throws on AbortSignal so callers can name-check or
 *  instanceof-check. Pipeline catches `name === "AbortError"` and translates
 *  into a session-delete instead of a "failed" toast. */
function makeAbortError(): Error {
  // DOMException isn't available in every test environment; fall back to a
  // plain Error with the conventional name + message.
  if (typeof DOMException !== "undefined") {
    return new DOMException("aborted", "AbortError");
  }
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

interface RunCliOpts {
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** Per-line callback for stdout (used for NDJSON event streams). The raw
   *  stdout is also captured in the return value. */
  onStdoutLine?: (line: string) => void;
}

interface RunCliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn a CLI with abort-signal wiring. Resolves on `close`, rejects with
 *  AbortError if `signal` fires, rejects with the spawn error if the binary
 *  is missing. Both the existing Claude Code provider and the new Codex
 *  provider share this so the run-overlay Cancel button actually kills the
 *  child process instead of letting it silently finish.
 *
 *  Settle discipline: `error`, `close`, abort, and `spawn().catch` can each
 *  fire. We use a single `settled` flag so whichever event fires first wins
 *  and the rest are dropped. Without this, an `error` event followed by a
 *  `close` event would resolve the promise twice and silently swallow the
 *  exit code.
 *
 *  Signal race: the abort listener is wired BEFORE `cmd.spawn()` resolves so
 *  an early-fire abort still kills the child. We hold the child handle in a
 *  closure ref that the abort callback reads — if abort fires before spawn
 *  resolves, the spawn-resolve path checks the same flag and kills as soon
 *  as it has the handle. */
async function runCli(
  program: string,
  args: string[],
  opts: RunCliOpts = {}
): Promise<RunCliResult> {
  return new Promise<RunCliResult>((resolve, reject) => {
    const cmd = opts.env
      ? Command.create(program, args, { env: opts.env })
      : Command.create(program, args);

    let stdout = "";
    let stderr = "";
    let settled = false;
    let aborted = false;
    let child: { kill: () => Promise<void> } | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const tryKill = () => {
      // Best-effort kill; if the process already exited, this is a no-op.
      child?.kill().catch(() => {});
    };

    cmd.stdout.on("data", (line) => {
      stdout += line;
      // Tauri's Command<string> emits the data event roughly per-line, so
      // forward each emission to the consumer's NDJSON parser as-is.
      if (opts.onStdoutLine && line) opts.onStdoutLine(String(line));
    });
    cmd.stderr.on("data", (line) => {
      stderr += line;
    });
    cmd.on("error", (err) => {
      finish(() => reject(new Error(String(err))));
    });
    cmd.on("close", (data) => {
      finish(() => {
        if (aborted) {
          reject(makeAbortError());
          return;
        }
        resolve({ code: data.code, stdout, stderr });
      });
    });

    // Wire abort BEFORE spawn so an early-fire abort still kills the child.
    const onAbort = () => {
      aborted = true;
      tryKill();
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        // Signal was already aborted before we got here. Mark + skip spawn.
        finish(() => reject(makeAbortError()));
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    cmd.spawn().then((c) => {
      child = c;
      // If the abort fired between addEventListener and spawn resolving, we
      // missed our chance to kill — do it now.
      if (aborted) tryKill();
    }).catch((err) => {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    });
  });
}

/** Heuristic: classify a CLI failure into install-missing vs auth-needed
 *  vs other. Each CLI surfaces these conditions differently across versions
 *  so we string-match on stderr — fragile but recoverable (worst case the
 *  user gets the generic "other" copy with the raw stderr available). */
function classifyCliError(raw: string, family: "claude" | "codex"): ProbeResult {
  const lower = raw.toLowerCase();
  if (
    lower.includes("command not found") ||
    lower.includes("no such file") ||
    lower.includes("enoent") ||
    lower.includes("not recognized") ||
    // Tauri shell-allow-execute denies a binary not in the capability list
    // with this prefix on some platforms.
    lower.includes("program not allowed")
  ) {
    return { ok: false, reason: "not_installed", raw };
  }
  if (
    lower.includes("not signed in") ||
    lower.includes("not logged in") ||
    lower.includes("login required") ||
    lower.includes("sign in") ||
    lower.includes("unauthor") ||           // unauthorized / unauthenticated
    lower.includes("authentication") ||
    lower.includes(`${family} login`) ||
    lower.includes("auth required") ||
    lower.includes("missing credentials") ||
    lower.includes("token expired") ||
    lower.includes("refresh token") ||
    lower.includes(" 401") || lower.startsWith("401") ||
    lower.includes(" 403") || lower.startsWith("403") ||
    lower.includes("forbidden")
  ) {
    return { ok: false, reason: "not_signed_in", raw };
  }
  return { ok: false, reason: "other", raw };
}

// ---- Claude Code (CLI) ----------------------------------------------------

/** Unset CLAUDECODE so the CLI doesn't refuse to run when Keepr is
 *  launched from inside a Claude Code terminal session. */
const CLAUDE_SPAWN_ENV: Record<string, string> = { CLAUDECODE: "" };

const claudeCode: LLMProvider = {
  id: "claude-code",
  category: "cli",
  label: "Claude Code",
  keyUrl: "",
  cli: {
    installCmd: "npm install -g @anthropic-ai/claude-code",
    installUrl: "docs.claude.com/en/docs/claude-code/setup",
    loginCmd: "claude login",
  },
  defaultSynthesisModel: "claude-sonnet-4-6",
  defaultClassifierModel: "claude-haiku-4-5-20251001",

  async complete(opts) {
    const userContent = opts.messages.map((m) => m.content).join("\n");
    const args = ["--print", "--model", opts.model, "--output-format", "json"];
    if (opts.system) {
      args.push("--system-prompt", opts.system);
    }
    args.push(userContent);

    const result = await runCli("claude", args, {
      env: CLAUDE_SPAWN_ENV,
      signal: opts.signal,
    });
    if (result.code !== 0) {
      const msg = result.stderr || result.stdout || "claude exited with code " + result.code;
      throw new Error(`Claude Code error: ${msg.slice(0, 500)}`);
    }
    try {
      const data = JSON.parse(result.stdout);
      return {
        text: data.result ?? data.text ?? result.stdout,
        input_tokens: data.usage?.input_tokens ?? data.input_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? data.output_tokens ?? 0,
      };
    } catch {
      return { text: result.stdout.trim(), input_tokens: 0, output_tokens: 0 };
    }
  },

  async test() {
    // The probe IS the test. Force a fresh probe so a cached failure from a
    // prior session doesn't mask a now-working state.
    const probe = await probeClaudeCode(true);
    if (!probe.ok) {
      throw new Error(`Claude Code not available (${probe.reason}): ${probe.raw.slice(0, 300)}`);
    }
    return true;
  },
};

// ---- Codex (CLI) ----------------------------------------------------------

/** Build a hermetic temp dir for `codex exec -C <dir>` plus a temp file for
 *  `--output-last-message <file>`. Codex defaults its cwd to the user's
 *  current directory and would happily expose any files there to the model;
 *  the temp dir keeps the call free of the user's working tree. */
async function makeCodexWorkspace(): Promise<{ cwd: string; outFile: string; cleanup: () => Promise<void> }> {
  const base = await tempDir();
  const slug = `keepr-codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cwd = await join(base, slug);
  const outFile = await join(cwd, "last-message.txt");
  await mkdir(cwd, { recursive: true });
  return {
    cwd,
    outFile,
    cleanup: async () => {
      try {
        await remove(cwd, { recursive: true });
      } catch {
        // Best-effort. Tempdir cleanup happens at OS level eventually anyway.
      }
    },
  };
}

/** Parse the codex `--json` event stream. Each line is a JSON event; the
 *  task_complete event (or any final event with `usage`) carries token counts.
 *  Strategy: prefer task_complete events when present (they're the canonical
 *  final tally); otherwise fall back to the last event with usage seen.
 *  Returns null if no parseable usage appears — caller logs a console.warn
 *  and reports zero, which is the deliberate trade-off vs. failing the whole
 *  call on a parser hiccup. */
interface CodexUsage {
  input_tokens: number;
  output_tokens: number;
}
function pickUsageFromCodexEvents(lines: string[]): CodexUsage | null {
  let lastUsage: CodexUsage | null = null;
  let lastTaskCompleteUsage: CodexUsage | null = null;

  /** Pick the first non-zero numeric value from the candidates. Avoids the
   *  `0 ?? x` trap where input_tokens=0 would shadow prompt_tokens=42. */
  const pickPositive = (...candidates: unknown[]): number | null => {
    for (const c of candidates) {
      if (typeof c === "number" && c > 0) return c;
    }
    // No positive value — but if any candidate is exactly 0, return 0
    // (genuinely-zero usage is valid for tiny calls).
    for (const c of candidates) {
      if (typeof c === "number") return c;
    }
    return null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const evt: any = JSON.parse(trimmed);
      const u = evt?.usage ?? evt?.msg?.usage ?? evt?.payload?.usage ?? null;
      if (u && typeof u === "object") {
        const inTok = pickPositive(u.input_tokens, u.prompt_tokens, u.total_input_tokens);
        const outTok = pickPositive(u.output_tokens, u.completion_tokens, u.total_output_tokens);
        if (inTok !== null && outTok !== null) {
          const usage = { input_tokens: inTok, output_tokens: outTok };
          lastUsage = usage;
          const type = evt?.type ?? evt?.msg?.type ?? evt?.event ?? "";
          if (typeof type === "string" && /task[_-]?complete/i.test(type)) {
            lastTaskCompleteUsage = usage;
          }
        }
      }
    } catch {
      // Skip malformed lines silently — codex sometimes intermixes plain text.
    }
  }
  return lastTaskCompleteUsage ?? lastUsage;
}

const codex: LLMProvider = {
  id: "codex",
  category: "cli",
  label: "Codex",
  keyUrl: "",
  cli: {
    installCmd: "npm install -g @openai/codex",
    installUrl: "github.com/openai/codex",
    loginCmd: "codex login",
  },
  defaultSynthesisModel: "gpt-5",
  defaultClassifierModel: "gpt-5-mini",

  async complete(opts) {
    const ws = await makeCodexWorkspace();
    try {
      const prompt = [
        opts.system ? `[System]\n${opts.system}\n` : "",
        ...opts.messages.map((m) => m.content),
      ]
        .filter(Boolean)
        .join("\n");

      const args = [
        "exec",
        "-C", ws.cwd,
        "-s", "read-only",
        // `codex exec` requires a git repo by default; our hermetic tempdir
        // isn't one, so this flag is mandatory or the spawn fails before
        // the model is even contacted.
        "--skip-git-repo-check",
        // Don't persist a rollout file in ~/.codex/sessions/ — every Keepr
        // synthesis call would leave one behind.
        "--ephemeral",
        "--json",
        "--output-last-message", ws.outFile,
        "-m", opts.model,
        // `--` ensures a prompt that starts with `-` (e.g. a system message
        // formatted as "- bullet point") isn't parsed as a flag.
        "--",
        prompt,
      ];

      const eventLines: string[] = [];
      const result = await runCli("codex", args, {
        signal: opts.signal,
        onStdoutLine: (line) => {
          // Tauri may emit a chunk with embedded newlines; split on \n so the
          // NDJSON parser sees one event per entry.
          for (const l of line.split("\n")) {
            if (l.trim()) eventLines.push(l);
          }
        },
      });

      if (result.code !== 0) {
        const msg = result.stderr || result.stdout || "codex exited with code " + result.code;
        throw new Error(`Codex error: ${msg.slice(0, 500)}`);
      }

      let text = "";
      try {
        text = await readTextFile(ws.outFile);
      } catch {
        // Fall back to raw stdout if the output-last-message file is missing
        // (rare — codex writes it on every successful exec).
        text = result.stdout.trim();
      }

      const usage = pickUsageFromCodexEvents(eventLines);
      if (!usage) {
        // eslint-disable-next-line no-console
        console.warn(
          "[keepr] codex exec returned no parseable usage event; reporting zero tokens."
        );
      }

      return {
        text,
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
      };
    } finally {
      await ws.cleanup();
    }
  },

  async test() {
    // The probe IS the test. Force a fresh probe so a cached failure from a
    // prior session doesn't mask a now-working state.
    const probe = await probeCodex(true);
    if (!probe.ok) {
      throw new Error(`Codex not available (${probe.reason}): ${probe.raw.slice(0, 300)}`);
    }
    return true;
  },
};

// ---- CLI probe (shared module-level cache) --------------------------------

let _claudeProbeCache: ProbeResult | null = null;
let _claudeProbeInFlight: Promise<ProbeResult> | null = null;
let _codexProbeCache: ProbeResult | null = null;
let _codexProbeInFlight: Promise<ProbeResult> | null = null;

/** Detect whether `claude --print` will succeed in this app session.
 *  Symmetric with probeCodex — same caching, same in-flight dedup, same
 *  cache-poisoning fix. Lets StepLLM and Settings render <CliProviderPanel />
 *  for both CLI providers with one consistent state shape. */
export async function probeClaudeCode(force = false): Promise<ProbeResult> {
  if (!force && _claudeProbeCache) return _claudeProbeCache;
  if (_claudeProbeInFlight) return _claudeProbeInFlight;

  const promise = (async (): Promise<ProbeResult> => {
    const args = ["--print", "--model", "haiku", "Reply with just: ok"];
    let result: RunCliResult;
    try {
      result = await runCli("claude", args, { env: CLAUDE_SPAWN_ENV });
    } catch (e: any) {
      const r: ProbeResult = classifyCliError(String(e?.message || e), "claude");
      _claudeProbeCache = r;
      return r;
    }
    if (result.code === 0) {
      const r: ProbeResult = { ok: true };
      _claudeProbeCache = r;
      return r;
    }
    const raw = result.stderr || result.stdout || `exit code ${result.code}`;
    const r = classifyCliError(raw, "claude");
    _claudeProbeCache = r;
    return r;
  })();

  _claudeProbeInFlight = promise;
  promise.finally(() => {
    _claudeProbeInFlight = null;
  }).catch(() => {});

  return promise;
}

/** Wipe the cached Claude Code probe result. Call after the user reports
 *  they ran `claude login` so the next probeClaudeCode() actually re-checks. */
export function invalidateClaudeProbe(): void {
  _claudeProbeCache = null;
}

/** Test-only: read the cache without triggering a probe. */
export function _peekClaudeProbeCache(): ProbeResult | null {
  return _claudeProbeCache;
}

/** Detect whether `codex exec` will succeed in this app session. Cached so
 *  StepLLM (Detect button) and Settings (passive status) share one round-trip.
 *  Pass `force=true` to re-probe after the user takes recovery action like
 *  running `codex login` in a terminal.
 *
 *  Failure handling: if the in-flight probe rejects (rare — e.g. tempDir()
 *  itself fails), the in-flight ref is cleared so the NEXT caller retries
 *  fresh instead of awaiting the same poisoned promise forever. */
export async function probeCodex(force = false): Promise<ProbeResult> {
  if (!force && _codexProbeCache) return _codexProbeCache;
  if (_codexProbeInFlight) return _codexProbeInFlight;

  const promise = (async (): Promise<ProbeResult> => {
    const ws = await makeCodexWorkspace();
    try {
      const args = [
        "exec",
        "-C", ws.cwd,
        "-s", "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        "--json",
        "--output-last-message", ws.outFile,
        "--",
        "Reply with just: ok",
      ];
      let result: RunCliResult;
      try {
        result = await runCli("codex", args);
      } catch (e: any) {
        // runCli throws when the spawn itself fails (binary missing), so the
        // error message carries "command not found" or similar.
        const r: ProbeResult = classifyCliError(String(e?.message || e), "codex");
        _codexProbeCache = r;
        return r;
      }

      if (result.code === 0) {
        const r: ProbeResult = { ok: true };
        _codexProbeCache = r;
        return r;
      }
      const raw = result.stderr || result.stdout || `exit code ${result.code}`;
      const r = classifyCliError(raw, "codex");
      _codexProbeCache = r;
      return r;
    } finally {
      await ws.cleanup();
    }
  })();

  _codexProbeInFlight = promise;
  // Clear the in-flight ref on settle — both success AND rejection. Without
  // this, a rejected probe poisons the cache for the rest of the session.
  promise.finally(() => {
    _codexProbeInFlight = null;
  }).catch(() => {});

  return promise;
}

/** Wipe the cached probe result. Call after the user reports they ran
 *  `codex login` so the next probeCodex() actually re-checks. */
export function invalidateCodexProbe(): void {
  _codexProbeCache = null;
}

/** Test-only: read the cache without triggering a probe. */
export function _peekCodexProbeCache(): ProbeResult | null {
  return _codexProbeCache;
}

// ---- Provider registry ----------------------------------------------------

export const PROVIDERS: Record<LLMProviderId, LLMProvider> = {
  anthropic,
  openai,
  openrouter,
  custom,
  "claude-code": claudeCode,
  codex,
};

export function getProvider(id: LLMProviderId): LLMProvider {
  return PROVIDERS[id];
}

/** Group providers by category for the picker UI. Categories with zero
 *  members render no divider — relevant today because `self_hosted` is
 *  empty until Qwen Local / Ollama land. */
export function providersByCategory(): Record<LLMCategory, LLMProvider[]> {
  const out: Record<LLMCategory, LLMProvider[]> = {
    hosted: [],
    cli: [],
    self_hosted: [],
  };
  for (const p of Object.values(PROVIDERS)) {
    out[p.category].push(p);
  }
  return out;
}

// ---- Friendly error messages ----------------------------------------------

/** Translate raw provider errors into actionable user copy. Lives next to
 *  the providers it describes (was at StepLLM.tsx until this PR). Both
 *  StepLLM and Settings call this so error UX is identical across
 *  onboarding and the model panel. */
export function friendlyProviderError(e: any, provider: LLMProviderId): string {
  const raw = (e?.message || String(e) || "").toLowerCase();
  // eslint-disable-next-line no-console
  console.error("[keepr] provider error:", e?.message || e);

  if (provider === "codex") {
    if (raw.includes("not_installed") || raw.includes("command not found")) {
      return "Codex CLI not installed. Install with `npm install -g @openai/codex` or see github.com/openai/codex.";
    }
    if (raw.includes("not_signed_in") || raw.includes("codex login") || raw.includes("not logged in")) {
      return "Codex CLI is installed but not signed in. Run `codex login` in a terminal, then click Detect again.";
    }
  }

  if (raw.includes("credit_balance_too_low") || raw.includes("billing") || raw.includes("insufficient")) {
    return "The key is valid but the account has no API credits. Add a payment method + top up at platform.claude.com/settings/billing.";
  }
  if (raw.includes("401") || raw.includes("unauthorized") || raw.includes("invalid_api_key") || raw.includes("invalid x-api-key")) {
    if (provider === "anthropic") {
      return "Anthropic rejected that key (401). Possible causes: (1) the key was deactivated, (2) the account has no API billing set up at platform.claude.com/settings/billing, (3) you copied a truncated key. Check the DevTools console for the raw response and try creating a fresh key.";
    }
    if (provider === "custom") {
      return "Your endpoint returned 401 — check the API key or auth configuration.";
    }
    if (provider === "claude-code" || provider === "codex") {
      return "The CLI rejected the call. Try running its login command in a terminal.";
    }
    const host = new URL(getProvider(provider).keyUrl).host;
    return `That key didn't authorize. Double-check you copied it from ${host}.`;
  }
  if (raw.includes("429") || raw.includes("rate")) {
    return "Rate-limited on the test call. Wait a few seconds and try again.";
  }
  if (raw.includes("scope") || raw.includes("not allowed") || raw.includes("forbidden on")) {
    return "The Tauri HTTP scope is blocking this host. This is a Keepr bug — please file an issue.";
  }
  if (raw.includes("network") || raw.includes("fetch") || raw.includes("failed to connect")) {
    return "Couldn't reach the provider. Check your network and try again.";
  }
  return e?.message || "Test call failed.";
}
