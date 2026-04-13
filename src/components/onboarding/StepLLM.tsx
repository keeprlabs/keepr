// LLM provider step — pick a provider, paste a key, dignified test call.

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
import { SECRET_KEYS, getSecret, setSecret } from "../../services/secrets";
import { getProvider, setCustomConfig, type LLMProviderId } from "../../services/llm";
import { getConfig, setConfig, upsertIntegration } from "../../services/db";

const PROVIDERS: Array<{
  id: LLMProviderId;
  blurb: string;
  badge?: string;
}> = [
  {
    id: "anthropic",
    badge: "Recommended",
    blurb: "Claude Sonnet for synthesis, Haiku for the first-pass summaries.",
  },
  {
    id: "openai",
    blurb: "gpt-4o for synthesis, gpt-4o-mini for the classifier step.",
  },
  {
    id: "openrouter",
    blurb: "Gateway — any model, one key. Useful behind a corporate egress.",
  },
  {
    id: "custom",
    blurb: "Any OpenAI-compatible endpoint — Ollama, vLLM, LM Studio, etc.",
  },
];

export function StepLLM({ onNext }: { onNext: () => void }) {
  const [provider, setProvider] = useState<LLMProviderId>("anthropic");
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "ok" | "err">("idle");
  const [error, setError] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customSynthModel, setCustomSynthModel] = useState("");
  const [customClassModel, setCustomClassModel] = useState("");

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

  // When provider changes, reload any key already stored for that provider.
  useEffect(() => {
    (async () => {
      const existing = await getSecret(SECRET_KEYS[provider]);
      setKey(existing || "");
      setState("idle");
      setError("");
    })();
  }, [provider]);

  const p = getProvider(provider);

  const test = async () => {
    setState("testing");
    setError("");
    const trimmed = key.trim();

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

      <div className="mb-6 grid grid-cols-2 gap-2">
        {PROVIDERS.map((row) => {
          const active = provider === row.id;
          return (
            <button
              key={row.id}
              onClick={() => setProvider(row.id)}
              className={`rounded-md border px-3 py-3 text-left text-sm transition-all duration-180 ${
                active
                  ? "border-ink/45 bg-sunken"
                  : "border-hairline bg-canvas hover:border-ink/15"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium capitalize text-ink">{row.id}</div>
                {row.badge && (
                  <span className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                    {row.badge}
                  </span>
                )}
              </div>
              <div className="mt-[4px] text-xxs leading-snug text-ink-faint">
                {row.blurb}
              </div>
            </button>
          );
        })}
      </div>

      {provider === "custom" ? (
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
          disabled={(provider !== "custom" && !key.trim()) || state === "testing"}
        >
          {state === "testing" ? "Testing…" : "Test & save"}
        </PrimaryButton>
        <StatusLine
          state={state}
          message={state === "ok" ? "Key verified." : error}
        />
      </StepFooter>
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
  if (provider === "custom") return null;
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

function friendlyProviderError(e: any, provider: LLMProviderId): string {
  const raw = (e?.message || String(e) || "").toLowerCase();
  // Log the raw provider response to the DevTools console so the user
  // (or a support thread) can see exactly what came back without us
  // leaking it onto the onboarding screen.
  // eslint-disable-next-line no-console
  console.error("[keepr] provider test failed:", e?.message || e);
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
    const host = new URL(getProvider(provider).keyUrl).host;
    return `That key didn't authorize. Double-check you copied it from ${host}.`;
  }
  if (raw.includes("429") || raw.includes("rate")) {
    return "Rate-limited on the test call. Wait a few seconds and try again.";
  }
  if (raw.includes("scope") || raw.includes("not allowed") || raw.includes("forbidden on")) {
    return "The Tauri HTTP scope is blocking this host. This is an Keepr bug — please file an issue.";
  }
  if (raw.includes("network") || raw.includes("fetch") || raw.includes("failed to connect")) {
    return "Couldn't reach the provider. Check your network and try again.";
  }
  return e?.message || "Test call failed.";
}
