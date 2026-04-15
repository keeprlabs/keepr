// Progress overlay during a workflow run. Visual step-by-step
// progress with elapsed timer, stage icons, and active shimmer.

import { useEffect, useState } from "react";

export interface RunState {
  stage: "fetch" | "prune" | "map" | "synthesize" | "write" | "done" | "error";
  detail?: string;
  error?: string;
}

const STAGES: Array<RunState["stage"]> = [
  "fetch",
  "prune",
  "map",
  "synthesize",
  "write",
];

const LABELS: Record<RunState["stage"], string> = {
  fetch: "Gathering",
  prune: "Filtering",
  map: "Summarizing",
  synthesize: "Thinking",
  write: "Writing",
  done: "Ready",
  error: "Failed",
};

function useElapsed(running: boolean) {
  const [start] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [running, start]);
  const s = Math.floor(elapsed / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function RunOverlay({
  state,
  onDismiss,
  onCancel,
}: {
  state: RunState | null;
  onDismiss: () => void;
  onCancel?: () => void;
}) {
  if (!state) return null;

  if (
    import.meta.env.DEV &&
    state.stage !== "done" &&
    state.stage !== "error" &&
    !STAGES.includes(state.stage)
  ) {
    console.warn(`[RunOverlay] Unknown stage "${state.stage}" — progress may be stuck.`);
  }

  const stageIndex = STAGES.indexOf(state.stage);
  const isDone = state.stage === "done";
  const isError = state.stage === "error";
  const isRunning = !isDone && !isError;

  const elapsed = useElapsed(isRunning);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-canvas/80 backdrop-blur-[3px] rise" />
      <div className="sheet rise relative w-[min(520px,92vw)] px-9 py-8">
        {/* Logo + timer row */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <svg width="28" height="28" viewBox="0 0 512 512" fill="none" aria-hidden className="text-ink">
              <path d="M256 48 L256 464" stroke="currentColor" strokeWidth="42" strokeLinecap="round" />
              <path d="M256 180 L400 80" stroke="currentColor" strokeWidth="42" strokeLinecap="round" />
              <path d="M256 340 L400 440" stroke="currentColor" strokeWidth="42" strokeLinecap="round" />
              <rect x="80" y="210" width="70" height="70" rx="4" transform="rotate(45 115 245)" fill="currentColor" />
              <path d="M155 245 L256 245" stroke="currentColor" strokeWidth="20" strokeLinecap="round" />
            </svg>
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
              Keepr
            </span>
          </div>
          {isRunning && (
            <span className="mono text-sm tabular-nums text-ink-muted">
              {elapsed}
            </span>
          )}
        </div>

        {/* Stage heading */}
        <div className="display-serif-lg text-[28px] leading-[1.1] text-ink">
          {isError
            ? "Something went sideways."
            : isDone
            ? "Ready."
            : `${LABELS[state.stage]}…`}
        </div>

        {state.error && (
          <div className="mt-3 text-sm text-ink-soft">
            <span className="text-ink-muted">Error: </span>
            {state.error}
          </div>
        )}

        {/* Step indicators */}
        <div className="mt-8 flex flex-col gap-0">
          {STAGES.map((s, i) => {
            const done = i < stageIndex || isDone;
            const active = i === stageIndex && isRunning;
            return (
              <div key={s} className="flex items-center gap-3 py-[7px]">
                <div className={`flex items-center justify-center w-5 h-5 rounded-full shrink-0 transition-all duration-300 ${
                  done
                    ? "bg-ink"
                    : active
                    ? "border-2 border-ink"
                    : "border border-[rgba(10,10,10,0.12)]"
                }`}>
                  {done && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {active && (
                    <div className="w-2 h-2 rounded-full bg-ink breathing" />
                  )}
                </div>
                <span className={`text-xs uppercase tracking-[0.1em] transition-all duration-300 ${
                  done
                    ? "text-ink-muted"
                    : active
                    ? "text-ink font-medium"
                    : "text-ink-ghost"
                }`}>
                  {LABELS[s]}
                </span>
                {active && state.detail && (
                  <span className="text-xs text-ink-faint ml-auto truncate max-w-[180px]">
                    {state.detail}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {isError && (
          <div className="flex items-center gap-3 py-[7px] mt-0">
            <div className="flex items-center justify-center w-5 h-5 rounded-full shrink-0 bg-ink/20">
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <span className="text-xs text-ink-muted">{state.error?.slice(0, 80)}</span>
          </div>
        )}

        {isRunning && onCancel && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={onCancel}
              className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink-soft transition-colors duration-180 hover:border-ink/25 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        )}
        {(isDone || isError) && (
          <div className="mt-6 flex justify-end gap-2">
            {isError && (
              <button
                onClick={onDismiss}
                className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink-soft transition-colors duration-180 hover:border-ink/25 hover:text-ink"
              >
                Dismiss
              </button>
            )}
            {isDone && (
              <button
                onClick={onDismiss}
                className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors duration-180 hover:bg-ink-soft"
              >
                Open →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
