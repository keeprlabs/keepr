// Multi-provider LLM layer. Thin interface so workflows don't care which
// provider is active. Defaults to Anthropic; OpenAI and OpenRouter are
// drop-in alternatives.

import { fetch } from "@tauri-apps/plugin-http";
import { Command } from "@tauri-apps/plugin-shell";
import { SECRET_KEYS, getSecret } from "./secrets";

export type LLMProviderId = "anthropic" | "openai" | "openrouter" | "custom" | "claude-code";

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
}

export interface LLMCallResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
}

export interface LLMProvider {
  id: LLMProviderId;
  label: string;
  keyUrl: string;
  defaultSynthesisModel: string;
  defaultClassifierModel: string;
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

// ---- Claude Code (CLI) ----------------------------------------------------

/** Flatten system + messages into a single prompt string for `claude --print`. */
function buildCliPrompt(system: string | undefined, messages: LLMMessage[]): string {
  const parts: string[] = [];
  if (system) {
    parts.push(`[System]\n${system}\n`);
  }
  for (const m of messages) {
    if (m.role === "system") {
      parts.push(`[System]\n${m.content}\n`);
    } else {
      parts.push(m.content);
    }
  }
  return parts.join("\n");
}

/** Cached path to the `claude` binary once discovered. */
let _claudePath: string | null = null;

/** Try executing `claude` at the given path. Returns true if it works. */
async function probeClaude(cmd: string): Promise<boolean> {
  try {
    const out = await Command.create("claude", ["--version"]).execute();
    return out.code === 0;
  } catch {
    return false;
  }
}

const claudeCode: LLMProvider = {
  id: "claude-code",
  label: "Claude Code",
  keyUrl: "",
  defaultSynthesisModel: "claude-sonnet-4-6",
  defaultClassifierModel: "claude-haiku-4-5-20251001",

  async complete(opts) {
    const prompt = buildCliPrompt(opts.system, opts.messages);
    const args = [
      "--print",
      "--model", opts.model,
      "--output-format", "json",
      prompt,
    ];
    const result = await Command.create("claude", args).execute();
    if (result.code !== 0) {
      const msg = result.stderr || result.stdout || "claude exited with code " + result.code;
      throw new Error(`Claude Code error: ${msg.slice(0, 500)}`);
    }
    // Try to parse JSON output for structured result + token counts.
    try {
      const data = JSON.parse(result.stdout);
      return {
        text: data.result ?? data.text ?? result.stdout,
        input_tokens: data.usage?.input_tokens ?? data.input_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? data.output_tokens ?? 0,
      };
    } catch {
      // Fallback: treat raw stdout as the text response.
      return { text: result.stdout.trim(), input_tokens: 0, output_tokens: 0 };
    }
  },

  async test() {
    const args = [
      "--print",
      "--model", "haiku",
      "Reply with just: ok",
    ];
    const result = await Command.create("claude", args).execute();
    if (result.code !== 0) {
      const msg = result.stderr || result.stdout || "exit code " + result.code;
      throw new Error(`Claude Code not available: ${msg.slice(0, 300)}`);
    }
    return true;
  },
};

export const PROVIDERS: Record<LLMProviderId, LLMProvider> = {
  anthropic,
  openai,
  openrouter,
  custom,
  "claude-code": claudeCode,
};

export function getProvider(id: LLMProviderId): LLMProvider {
  return PROVIDERS[id];
}
