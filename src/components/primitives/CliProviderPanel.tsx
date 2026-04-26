// Renders the four states of a CLI-detected LLM provider (Claude Code, Codex,
// future tools): idle (pre-detect), ok (detected), not-installed, not-signed-in.
// Used by both the onboarding StepLLM and the Settings panel — all CLI-provider
// state lives here, not duplicated across consumers.
//
// State diagram:
//
//   idle ──[Detect clicked]──► (probing) ──► ok        (green status)
//                                       └──► not_installed   (install help block)
//                                       └──► not_signed_in   (click-to-copy + retry)
//                                       └──► other           (friendlyProviderError)
//
// The component is presentational: probing / retry behavior lives in the
// consumer (which calls probeCodex / probeClaudeCode and passes the result in).

import { useState } from "react";
import type { LLMProvider, ProbeResult } from "../../services/llm";

export interface CliProviderPanelProps {
  provider: LLMProvider;
  probe: ProbeResult | null; // null = idle (not yet probed)
  onRetry?: () => void;
  /** Friendly error message for `reason: "other"` — supplied by consumer
   *  via the `friendlyProviderError` helper. */
  otherErrorMessage?: string;
}

export function CliProviderPanel({
  provider,
  probe,
  onRetry,
  otherErrorMessage,
}: CliProviderPanelProps) {
  if (!provider.cli) {
    // Defensive: should never render this panel for non-CLI providers.
    return null;
  }

  // Idle: provider just picked, no probe yet.
  if (probe === null) {
    return (
      <div className="mb-4 rounded-md border border-hairline bg-sunken px-4 py-4 text-sm text-ink-soft">
        <p className="font-medium text-ink">No API key required.</p>
        <p className="mt-1 text-xxs leading-snug text-ink-faint">
          Keepr will use your installed {provider.label} CLI. Billing goes
          through your existing {provider.label} account.
        </p>
      </div>
    );
  }

  // Detected: passive confirmation.
  if (probe.ok) {
    return (
      <div className="mb-4 rounded-md border border-hairline bg-sunken px-4 py-4 text-sm text-ink-soft">
        <p className="font-medium text-ink">
          {provider.label} CLI: detected ✓
        </p>
        <p className="mt-1 text-xxs leading-snug text-ink-faint">
          Billing goes through your existing {provider.label} account.
        </p>
      </div>
    );
  }

  // Failed probe: render reason-specific help INSIDE the card.
  return (
    <div className="mb-4 rounded-md border border-hairline bg-sunken px-4 py-4 text-sm text-ink-soft">
      {probe.reason === "not_installed" && (
        <NotInstalledHelp provider={provider} onRetry={onRetry} />
      )}
      {probe.reason === "not_signed_in" && (
        <NotSignedInHelp provider={provider} onRetry={onRetry} />
      )}
      {probe.reason === "other" && (
        <div>
          <p className="text-xs leading-snug text-ink">
            {otherErrorMessage || "Detection failed. Check your network and try again."}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-xs text-ink-soft transition-colors duration-180 hover:border-ink/20 hover:text-ink"
            >
              Detect again
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NotInstalledHelp({
  provider,
  onRetry,
}: {
  provider: LLMProvider;
  onRetry?: () => void;
}) {
  const installCmd = provider.cli?.installCmd;
  const installUrl = provider.cli?.installUrl;
  return (
    <div>
      <p className="font-medium text-ink">{provider.label} CLI not installed.</p>
      <p className="mt-2 text-xxs leading-snug text-ink-faint">
        {installCmd && (
          <>
            Install with <code className="rounded bg-canvas px-1 py-0.5 text-ink">{installCmd}</code>
            {installUrl && " or "}
          </>
        )}
        {installUrl && isSafeBareUrl(installUrl) && (
          <>
            see{" "}
            <a
              href={`https://${installUrl}`}
              className="text-accent hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {installUrl}
            </a>
          </>
        )}
        .
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-xs text-ink-soft transition-colors duration-180 hover:border-ink/20 hover:text-ink"
        >
          Detect again
        </button>
      )}
    </div>
  );
}

function NotSignedInHelp({
  provider,
  onRetry,
}: {
  provider: LLMProvider;
  onRetry?: () => void;
}) {
  const loginCmd = provider.cli?.loginCmd;
  return (
    <div>
      <p className="font-medium text-ink">
        {provider.label} CLI installed but not signed in.
      </p>
      {loginCmd && (
        <>
          <p className="mt-2 text-xxs leading-snug text-ink-faint">
            Run this in a terminal, then click Detect again:
          </p>
          <CopyCommandButton cmd={loginCmd} />
        </>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-xs text-ink-soft transition-colors duration-180 hover:border-ink/20 hover:text-ink"
        >
          Detect again
        </button>
      )}
    </div>
  );
}

/** Reject install URLs that aren't bare host+path. The PROVIDERS table is
 *  trusted today, but this guard turns "must verify every entry by hand"
 *  into "the link is silently dropped if someone mistypes a scheme or
 *  pastes whitespace". Defense-in-depth, basically free. */
function isSafeBareUrl(s: string): boolean {
  if (!s || /\s/.test(s)) return false;
  if (s.includes("://") || s.startsWith("/")) return false;
  // Require at least one dot in the host portion.
  return /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(s);
}

function CopyCommandButton({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard write can fail in headless / sandboxed contexts. Stay silent —
      // the command is rendered inline so the user can still copy it manually.
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      // aria-label flips to "Copied" while the success state is showing so
      // screen readers get the same feedback sighted users get from the icon.
      aria-label={copied ? `Copied: ${cmd}` : `Copy command: ${cmd}`}
      className="mt-2 inline-flex items-center gap-2 rounded-md border border-hairline bg-canvas px-3 py-1.5 font-mono text-xs text-ink transition-colors duration-180 hover:border-ink/20"
    >
      <code>{cmd}</code>
      <span className="text-ink-faint" aria-hidden>
        {copied ? "✓ copied" : "📋"}
      </span>
    </button>
  );
}
