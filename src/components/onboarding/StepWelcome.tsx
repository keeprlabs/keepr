// First onboarding screen — the composed welcome. Two paths, clearly
// unequal in weight: "Set up with your real data" is the primary action,
// "Try with sample data" is a dignified secondary affordance for the
// OAuth-averse EM who wants to see the output before handing over tokens.
//
// This page is a single confident decision, not a form.

import { Title } from "./primitives";

export function StepWelcome({
  onStartReal,
  onStartDemo,
}: {
  onStartReal: () => void;
  onStartDemo: () => void;
}) {
  return (
    <div>
      <div className="text-xxs uppercase tracking-[0.14em] text-ink-faint mb-4">
        Welcome
      </div>
      <Title>A quiet read on your team,<br />whenever you need one.</Title>
      <p className="mb-10 max-w-[56ch] text-md text-ink-muted leading-relaxed">
        Keepr reads your Slack, GitHub, Jira, and Linear, prunes the noise,
        and writes you a short brief before your 1:1 or on Monday morning.
        It runs entirely on your laptop and keeps its memory as plain
        markdown you own.
      </p>

      <div className="mb-10 grid grid-cols-2 gap-3">
        <PathCard
          onClick={onStartReal}
          kind="primary"
          eyebrow="Set up with your real data"
          title="Connect your tools"
          body="Eight quick steps, about ten minutes. Connect Slack, GitHub, Jira, Linear (all optional except LLM key)."
          hint="Recommended"
        />
        <PathCard
          onClick={onStartDemo}
          kind="ghost"
          eyebrow="Try with sample data"
          title="Run on a synthetic team"
          body="Five fake engineers, a week of invented Slack + GitHub activity. Keepr still calls a real model — so you'll need an LLM key — but no OAuth, no PAT."
          hint="~2 minutes"
        />
      </div>

      <div className="text-xxs text-ink-faint">
        No account, no telemetry, no cloud sync. Everything below is
        opt-in, one decision at a time.
      </div>
    </div>
  );
}

function PathCard({
  onClick,
  kind,
  eyebrow,
  title,
  body,
  hint,
}: {
  onClick: () => void;
  kind: "primary" | "ghost";
  eyebrow: string;
  title: string;
  body: string;
  hint: string;
}) {
  const isPrimary = kind === "primary";
  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col items-start rounded-lg border p-5 text-left transition-all duration-180 ease-calm ${
        isPrimary
          ? "border-ink/45 bg-sunken hover:border-ink/60"
          : "border-hairline bg-canvas hover:border-ink/20"
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        {eyebrow}
      </div>
      <div
        className="mt-2 text-lg text-ink leading-snug"
        dangerouslySetInnerHTML={{ __html: title }}
      />
      <div className="mt-2 text-xs text-ink-muted leading-relaxed">{body}</div>
      <div className="mt-5 flex items-center justify-between w-full">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          {hint}
        </span>
        <span className="text-sm text-ink group-hover:translate-x-[2px] transition-transform duration-180">
          →
        </span>
      </div>
    </button>
  );
}
