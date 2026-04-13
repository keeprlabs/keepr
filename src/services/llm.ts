// Multi-provider LLM layer. Thin interface so workflows don't care which
// provider is active. Defaults to Anthropic; OpenAI and OpenRouter are
// drop-in alternatives.

import { fetch } from "@tauri-apps/plugin-http";
import { SECRET_KEYS, getSecret } from "./secrets";

export type LLMProviderId = "anthropic" | "openai" | "openrouter";

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

export const PROVIDERS: Record<LLMProviderId, LLMProvider> = {
  anthropic,
  openai,
  openrouter,
};

export function getProvider(id: LLMProviderId): LLMProvider {
  return PROVIDERS[id];
}
