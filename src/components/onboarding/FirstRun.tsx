// First-run empty state — shown after onboarding completes but before
// the user has any sessions. ⌘K is the central affordance. The whole
// page is one whispered instruction: press this, run your first pulse.
//
// Lives under src/components/onboarding/ because it's part of the
// first-run experience surface area, not the Home screen proper.

interface Props {
  demoMode: boolean;
  onOpenPalette: () => void;
  onRunFirstPulse: () => void;
}

export function FirstRun({ demoMode, onOpenPalette, onRunFirstPulse }: Props) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col items-center justify-center px-10 py-24 text-center">
        <div className="text-xxs uppercase tracking-[0.14em] text-ink-faint">
          {demoMode ? "Demo mode · ready" : "Ready"}
        </div>
        <h1 className="display-serif mt-4 text-[38px] leading-[1.1] text-ink">
          Let's make your first read.
        </h1>
        <p className="mt-5 max-w-[48ch] text-md text-ink-muted">
          {demoMode
            ? "Run a team pulse on the synthetic data. Keepr will call your LLM provider, synthesize the week, and write it to your Keepr-Demo folder."
            : "Run a team pulse over the last seven days. Keepr will read Slack and GitHub, prune the noise, and write you a short brief."}
        </p>

        <button
          onClick={onOpenPalette}
          className="mt-12 inline-flex items-center gap-2 rounded-full border border-hairline bg-canvas px-4 py-2 text-sm text-ink-muted transition-all duration-180 ease-calm hover:border-ink/25 hover:text-ink"
          aria-label="Open command palette"
        >
          <span>Search or run a command</span>
          <span className="mono text-[10px] text-ink-faint">⌘K</span>
        </button>

        <div className="mt-6 text-xxs text-ink-faint">
          Everything in Keepr is reachable from the palette.
        </div>

        <button
          onClick={onRunFirstPulse}
          className="mt-14 text-sm text-ink-soft underline decoration-hairline decoration-2 underline-offset-4 hover:decoration-ink/30 transition-colors"
        >
          or run team pulse now →
        </button>
      </div>
    </div>
  );
}
