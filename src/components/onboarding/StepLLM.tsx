// LLM provider step — pick a provider, paste a key (or detect a CLI),
// dignified test call.

import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  Field,
  GhostButton,
  Input,
  Lede,
  PrimaryButton,
  StatusLine,
  StepFooter,
  Title,
} from "./primitives";
import { CategoryDivider } from "../primitives/CategoryDivider";
import { CliProviderPanel } from "../primitives/CliProviderPanel";
import { SECRET_KEYS, getSecret, setSecret } from "../../services/secrets";
import {
  friendlyProviderError,
  getProvider,
  invalidateClaudeProbe,
  invalidateCodexProbe,
  probeClaudeCode,
  probeCodex,
  providersByCategory,
  setCustomConfig,
  type LLMCategory,
  type LLMProvider,
  type LLMProviderId,
  type ProbeResult,
} from "../../services/llm";
import { getConfig, setConfig, upsertIntegration } from "../../services/db";

/** Per-provider blurb + badge for the picker card. The provider runtime
 *  (interface, complete/test, category, cli metadata) lives in services/llm. */
const CARDS: Record<LLMProviderId, { blurb: string; badge?: string }> = {
  anthropic: {
    badge: "Recommended",
    blurb: "Claude Sonnet for synthesis, Haiku for the first-pass summaries.",
  },
  openai: {
    blurb: "gpt-4o for synthesis, gpt-4o-mini for the classifier step.",
  },
  openrouter: {
    blurb: "Gateway — any model, one key. Useful behind a corporate egress.",
  },
  custom: {
    blurb: "Any OpenAI-compatible endpoint — Ollama, vLLM, LM Studio, etc.",
  },
  "claude-code": {
    badge: "No API key",
    blurb: "Uses your installed Claude Code CLI. No separate API key needed.",
  },
  codex: {
    badge: "No API key",
    blurb: "Uses your installed Codex CLI. Defaults work for both ChatGPT-account and API-key auth.",
  },
};

/** Render order for category sections. Empty categories don't render their
 *  divider (relevant today because self_hosted is empty until Qwen Local lands). */
const CATEGORY_ORDER: LLMCategory[] = ["hosted", "cli", "self_hosted"];
const CATEGORY_LABELS: Record<LLMCategory, string> = {
  hosted: "Hosted",
  cli: "Local CLI",
  self_hosted: "Self-hosted",
};

const CLI_PROVIDERS = new Set<LLMProviderId>(["claude-code", "codex"]);

export function StepLLM({ onNext }: { onNext: () => void }) {
  const [provider, setProvider] = useState<LLMProviderId>("anthropic");
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "ok" | "err">("idle");
  const [error, setError] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customSynthModel, setCustomSynthModel] = useState("");
  const [customClassModel, setCustomClassModel] = useState("");
  // Probe result for the active CLI provider. Reset to null on provider
  // change so the panel returns to its idle "No API key required" copy.
  const [probe, setProbe] = useState<ProbeResult | null>(null);

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      if (cfg.llm_provider) setProvider(cfg.llm_provider);
      const existing = await getSecret(SECRET_KEYS[cfg.llm_provider || "anthropic"]);
      if (existing) setKey(existing);
      if (cfg.custom_llm_base_url) setCustomBaseUrl(cfg.custom_llm_base_url);
      if (cfg.custom_llm_synthesis_model) setCustomSynthModel(cfg.custom_llm_synthesis_model);
      if (cfg.custom_llm_classifier_model) setCustomClassModel(cfg.custom_llm_classifier_model);
    })();
  }, []);

  // When provider changes, reload any key already stored for that provider
  // and clear the probe (the new provider hasn't been detected yet).
  useEffect(() => {
    (async () => {
      if (CLI_PROVIDERS.has(provider)) {
        setKey("");
      } else {
        const existing = await getSecret(SECRET_KEYS[provider]);
        setKey(existing || "");
      }
      setState("idle");
      setError("");
      setProbe(null);
    })();
  }, [provider]);

  const p = getProvider(provider);
  const groups = providersByCategory();

  const test = async () => {
    setState("testing");
    setError("");
    const trimmed = key.trim();

    if (CLI_PROVIDERS.has(provider)) {
      // CLI providers: call the structured probe directly so we can render
      // a typed ProbeResult in the panel (install vs login vs other).
      // force=true bypasses the cached failure from a prior attempt.
      const fn = provider === "codex" ? probeCodex : probeClaudeCode;
      const result = await fn(true);
      setProbe(result);
      if (!result.ok) {
        setState("err");
        // Inline help is rendered by CliProviderPanel; the StatusLine just
        // names the failure mode briefly.
        const reasonCopy =
          result.reason === "not_installed"
            ? `${p.label} CLI not installed.`
            : result.reason === "not_signed_in"
            ? `${p.label} installed but not signed in.`
            : friendlyProviderError(new Error(result.raw), provider);
        setError(reasonCopy);
        return;
      }
      // Probe succeeded — persist and record the integration. Wrap the
      // SQL writes so a schema mismatch (e.g. provider missing from the
      // integrations CHECK constraint) surfaces inline instead of
      // leaving the button stuck on "Detecting…".
      try {
        await upsertIntegration(provider, {});
        await setConfig({
          llm_provider: provider,
          synthesis_model: p.defaultSynthesisModel,
          classifier_model: p.defaultClassifierModel,
        });
        setState("ok");
      } catch (e: any) {
        setState("err");
        setError(friendlyProviderError(e, provider));
      }
      return;
    }

    if (provider === "custom") {
      if (!customBaseUrl.trim()) {
        setState("err");
        setError("Enter a base URL for your endpoint (e.g. http://localhost:11434).");
        return;
      }
      if (!customSynthModel.trim() || !customClassModel.trim()) {
        setState("err");
        setError("Enter both a synthesis model and a classifier model name.");
        return;
      }
      // Configure the custom provider before testing.
      setCustomConfig({
        base_url: customBaseUrl.trim(),
        synthesis_model: customSynthModel.trim(),
        classifier_model: customClassModel.trim(),
      });
    } else {
      // Format pre-check — catches the common "pasted from the wrong page"
      // failure mode (e.g. copying from claude.ai or a dashboard session
      // cookie instead of console.anthropic.com/settings/keys).
      const formatProblem = keyFormatProblem(provider, trimmed);
      if (formatProblem) {
        setState("err");
        setError(formatProblem);
        return;
      }
    }

    try {
      // Verify the key against the provider FIRST, bypassing the keychain
      // so we can (a) avoid a get-after-set race in unsigned macOS dev
      // builds and (b) never persist a key that doesn't work.
      const ok = await p.test(trimmed || undefined);
      if (!ok) throw new Error("Test call did not return a success.");
      // Test passed — persist and record the integration.
      if (trimmed) await setSecret(SECRET_KEYS[provider], trimmed);
      await upsertIntegration(provider, {});
      const configPatch: Record<string, any> = {
        llm_provider: provider,
        synthesis_model: provider === "custom" ? customSynthModel.trim() : p.defaultSynthesisModel,
        classifier_model: provider === "custom" ? customClassModel.trim() : p.defaultClassifierModel,
      };
      if (provider === "custom") {
        configPatch.custom_llm_base_url = customBaseUrl.trim();
        configPatch.custom_llm_synthesis_model = customSynthModel.trim();
        configPatch.custom_llm_classifier_model = customClassModel.trim();
      }
      await setConfig(configPatch);
      setState("ok");
    } catch (e: any) {
      setState("err");
      setError(friendlyProviderError(e, provider));
    }
  };

  /** Detect-again handler for the not_signed_in / not_installed states.
   *  Bypasses the cache so the user's terminal recovery (codex login etc.)
   *  is actually retried instead of returning the cached failure. */
  const onRetryProbe = () => {
    if (provider === "codex") invalidateCodexProbe();
    if (provider === "claude-code") invalidateClaudeProbe();
    test();
  };

  return (
    <div>
      <Title>Pick a model to think with.</Title>
      <Lede>
        Keepr uses your own API key. Nothing routes through a middleman —
        your data goes directly from this laptop to the provider you pick.
      </Lede>
      <p className="mb-4 text-xxs leading-snug text-ink-faint">
        Have a Claude Pro subscription? You still need a separate API key from{" "}
        <button
          className="text-accent hover:underline"
          onClick={(e) => {
            e.preventDefault();
            openExternal("https://console.anthropic.com/settings/keys");
          }}
        >
          console.anthropic.com
        </button>
        {" "}— Pro subscriptions don't include API access.
      </p>

      <div className="mb-6">
        <CategorizedProviderGrid
          groups={groups}
          active={provider}
          onPick={setProvider}
        />
      </div>

      {CLI_PROVIDERS.has(provider) ? (
        <CliProviderPanel
          provider={p}
          probe={probe}
          onRetry={state === "err" ? onRetryProbe : undefined}
          otherErrorMessage={
            probe && !probe.ok && probe.reason === "other"
              ? friendlyProviderError(new Error(probe.raw), provider)
              : undefined
          }
        />
      ) : provider === "custom" ? (
        <>
          <Field label="Base URL" hint="The root URL of your OpenAI-compatible server (e.g. http://localhost:11434)">
            <Input
              placeholder="http://localhost:11434"
              value={customBaseUrl}
              onChange={(e) => { setCustomBaseUrl(e.target.value); if (state !== "idle") setState("idle"); }}
            />
          </Field>
          <Field label="Synthesis model" hint="The larger model for final output (e.g. llama3.1:70b, mistral-large)">
            <Input
              placeholder="llama3.1:70b"
              value={customSynthModel}
              onChange={(e) => { setCustomSynthModel(e.target.value); if (state !== "idle") setState("idle"); }}
            />
          </Field>
          <Field label="Classifier model" hint="A fast/cheap model for the first-pass summaries (e.g. llama3.1:8b, phi3)">
            <Input
              placeholder="llama3.1:8b"
              value={customClassModel}
              onChange={(e) => { setCustomClassModel(e.target.value); if (state !== "idle") setState("idle"); }}
            />
          </Field>
          <Field label="API key (optional)" hint="Leave blank if your endpoint doesn't require auth">
            <Input
              type="password"
              placeholder="optional"
              value={key}
              onChange={(e) => { setKey(e.target.value); if (state !== "idle") setState("idle"); }}
            />
          </Field>
        </>
      ) : (
        <Field
          label={`${p.label} API key`}
          hint={
            <>
              Don't have one?{" "}
              <button
                className="text-accent hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  openExternal(p.keyUrl);
                }}
              >
                Create one at {new URL(p.keyUrl).host}
              </button>
            </>
          }
        >
          <Input
            type="password"
            placeholder="sk-…"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              if (state !== "idle") setState("idle");
            }}
          />
        </Field>
      )}

      <StepFooter
        right={
          <GhostButton disabled={state !== "ok"} onClick={onNext}>
            Continue →
          </GhostButton>
        }
      >
        <PrimaryButton
          onClick={test}
          disabled={
            (!CLI_PROVIDERS.has(provider) && provider !== "custom" && !key.trim()) ||
            state === "testing"
          }
        >
          {state === "testing"
            ? CLI_PROVIDERS.has(provider)
              ? "Detecting…"
              : "Testing…"
            : CLI_PROVIDERS.has(provider)
            ? "Detect & save"
            : "Test & save"}
        </PrimaryButton>
        <StatusLine
          state={state}
          message={
            state === "ok"
              ? CLI_PROVIDERS.has(provider)
                ? `${p.label} detected.`
                : "Key verified."
              : error
          }
        />
      </StepFooter>
    </div>
  );
}

/** Renders the provider cards grouped by category, with a CategoryDivider
 *  between non-empty groups. Adding a new provider = one new entry in
 *  PROVIDERS in services/llm.ts; no change here. */
function CategorizedProviderGrid({
  groups,
  active,
  onPick,
}: {
  groups: Record<LLMCategory, LLMProvider[]>;
  active: LLMProviderId;
  onPick: (id: LLMProviderId) => void;
}) {
  const sections = CATEGORY_ORDER
    .map((cat) => ({ cat, providers: groups[cat] }))
    .filter((s) => s.providers.length > 0);

  return (
    <div>
      {sections.map((section, idx) => (
        <div key={section.cat}>
          {idx > 0 && <CategoryDivider label={CATEGORY_LABELS[section.cat]} />}
          <div className="grid grid-cols-2 gap-2">
            {section.providers.map((row) => {
              const card = CARDS[row.id];
              const isActive = active === row.id;
              return (
                <button
                  key={row.id}
                  onClick={() => onPick(row.id)}
                  className={`rounded-md border px-3 py-3 text-left text-sm transition-all duration-180 ${
                    isActive
                      ? "border-ink/45 bg-sunken"
                      : "border-hairline bg-canvas hover:border-ink/15"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium capitalize text-ink">{row.id}</div>
                    {card?.badge && (
                      <span className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                        {card.badge}
                      </span>
                    )}
                  </div>
                  <div className="mt-[4px] text-xxs leading-snug text-ink-faint">
                    {card?.blurb || ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Sanity-check the shape before we ever hit the network. Catches the most
// common mistake: copying from the wrong page. Anthropic keys start with
// `sk-ant-`, OpenAI keys with `sk-`, OpenRouter keys with `sk-or-`. None of
// them contain whitespace or are shorter than ~40 chars.
function keyFormatProblem(
  provider: LLMProviderId,
  key: string
): string | null {
  if (provider === "custom" || CLI_PROVIDERS.has(provider)) return null;
  if (!key) return "Paste your API key to continue.";
  if (/\s/.test(key)) return "That key has whitespace in it — try copying again.";
  if (key.length < 20) return "That looks too short to be an API key.";
  if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
    return "Anthropic API keys start with 'sk-ant-'. Grab one from platform.claude.com/settings/keys (NOT claude.ai, which is the consumer chat product).";
  }
  if (provider === "openrouter" && !key.startsWith("sk-or-")) {
    return "OpenRouter keys start with 'sk-or-'. Grab one from openrouter.ai/keys.";
  }
  if (provider === "openai" && !key.startsWith("sk-")) {
    return "OpenAI keys start with 'sk-'. Grab one from platform.openai.com/api-keys.";
  }
  return null;
}
