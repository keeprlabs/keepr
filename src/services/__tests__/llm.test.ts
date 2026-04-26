// Tests for the LLMProvider data layer + friendlyProviderError taxonomy +
// providersByCategory grouping. CLI spawn behavior (probeCodex, codex.complete,
// claudeCode AbortError) is exercised in a sibling file with the Tauri
// shell/path/fs plugins mocked.

import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  getProvider,
  providersByCategory,
  friendlyProviderError,
} from "../llm";

describe("LLMProvider categorization", () => {
  it("hosted providers are tagged hosted", () => {
    expect(PROVIDERS.anthropic.category).toBe("hosted");
    expect(PROVIDERS.openai.category).toBe("hosted");
    expect(PROVIDERS.openrouter.category).toBe("hosted");
    expect(PROVIDERS.custom.category).toBe("hosted");
  });

  it("CLI-detected providers are tagged cli and carry login metadata", () => {
    const cc = PROVIDERS["claude-code"];
    expect(cc.category).toBe("cli");
    expect(cc.cli?.loginCmd).toBe("claude login");
    expect(cc.cli?.installCmd).toBeTruthy();
    expect(cc.cli?.installUrl).toBeTruthy();

    const cx = PROVIDERS.codex;
    expect(cx.category).toBe("cli");
    expect(cx.cli?.loginCmd).toBe("codex login");
    expect(cx.cli?.installCmd).toContain("@openai/codex");
    expect(cx.cli?.installUrl).toBe("github.com/openai/codex");
  });

  it("hosted providers do NOT carry CLI metadata", () => {
    expect(PROVIDERS.anthropic.cli).toBeUndefined();
    expect(PROVIDERS.openai.cli).toBeUndefined();
  });

  it("getProvider returns the same instance as PROVIDERS lookup", () => {
    expect(getProvider("anthropic")).toBe(PROVIDERS.anthropic);
    expect(getProvider("claude-code")).toBe(PROVIDERS["claude-code"]);
    expect(getProvider("codex")).toBe(PROVIDERS.codex);
  });

  it("codex defaults to the only model pair that works on BOTH ChatGPT-account AND API-key auth", () => {
    // gpt-5.5 only works on ChatGPT auth (and even there is tier-dependent);
    // gpt-5 / gpt-5-mini aren't valid identifiers at all. gpt-5.4 / gpt-5.4-mini
    // is the safe-everywhere pair as of Codex CLI v0.125. See llm.ts for the
    // long comment explaining why.
    expect(PROVIDERS.codex.defaultSynthesisModel).toBe("gpt-5.4");
    expect(PROVIDERS.codex.defaultClassifierModel).toBe("gpt-5.4-mini");
  });
});

describe("providersByCategory", () => {
  it("groups all providers into the right buckets", () => {
    const groups = providersByCategory();
    expect(groups.hosted.map((p) => p.id).sort()).toEqual(
      ["anthropic", "custom", "openai", "openrouter"].sort()
    );
    expect(groups.cli.map((p) => p.id).sort()).toEqual(["claude-code", "codex"]);
    expect(groups.self_hosted).toEqual([]);
  });

  it("self_hosted is empty until a second self-hosted provider lands", () => {
    // See TODOS.md → "Split self_hosted as a third visible category".
    expect(providersByCategory().self_hosted).toHaveLength(0);
  });
});

describe("friendlyProviderError", () => {
  it("codex: not_installed surfaces install command", () => {
    const msg = friendlyProviderError(new Error("not_installed: command not found"), "codex");
    expect(msg).toContain("not installed");
    expect(msg).toContain("npm install");
    expect(msg).toContain("@openai/codex");
  });

  it("codex: not_signed_in surfaces login instruction", () => {
    const msg = friendlyProviderError(new Error("Codex not available (not_signed_in): auth required"), "codex");
    expect(msg).toContain("not signed in");
    expect(msg).toContain("codex login");
  });

  it("anthropic: 401 returns the detailed billing/key copy [regression]", () => {
    const msg = friendlyProviderError(new Error("Anthropic 401: invalid_api_key"), "anthropic");
    expect(msg).toContain("Anthropic rejected");
    expect(msg).toContain("billing");
  });

  it("openai: 401 returns the keyUrl host hint [regression]", () => {
    const msg = friendlyProviderError(new Error("OpenAI 401: unauthorized"), "openai");
    expect(msg).toContain("platform.openai.com");
  });

  it("billing low credit copy preserved for hosted providers [regression]", () => {
    const msg = friendlyProviderError(new Error("credit_balance_too_low"), "anthropic");
    expect(msg).toContain("API credits");
  });

  it("rate-limit copy preserved [regression]", () => {
    const msg = friendlyProviderError(new Error("429 Too Many Requests"), "openai");
    expect(msg).toContain("Rate-limited");
  });

  it("network failure copy preserved [regression]", () => {
    const msg = friendlyProviderError(new Error("network: failed to connect"), "openrouter");
    expect(msg).toContain("Couldn't reach");
  });

  it("claude-code 401 routes to CLI-login copy", () => {
    const msg = friendlyProviderError(new Error("401 unauthorized"), "claude-code");
    expect(msg).toContain("login command");
  });

  it("codex 401 routes to the CLI-login copy", () => {
    const msg = friendlyProviderError(new Error("401 unauthorized"), "codex");
    // The 401 substring routes to the shared CLI-login branch shared with
    // claude-code; the codex-specific branch only fires for messages that
    // already contain "not_signed_in" or similar markers from probeCodex.
    expect(msg).toContain("login");
  });

  it("falls back to the raw message when nothing matches", () => {
    const msg = friendlyProviderError(new Error("totally novel failure"), "openai");
    expect(msg).toBe("totally novel failure");
  });
});
