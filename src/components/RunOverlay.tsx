// Progress overlay during a workflow run. Alive but serene — a quiet
// progress line, not a spinner. Stage labels advance from faint to ink.

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
  map: "Summarizing sources",
  synthesize: "Thinking",
  write: "Writing",
  done: "Ready",
  error: "Failed",
};

export function RunOverlay({
  state,
  onDismiss,
}: {
  state: RunState | null;
  onDismiss: () => void;
}) {
  if (!state) return null;
  const stageIndex = STAGES.indexOf(state.stage);
  const isDone = state.stage === "done";
  const isError = state.stage === "error";
  const pct = isDone || isError
    ? 100
    : Math.max(8, Math.min(96, ((stageIndex + 0.5) / STAGES.length) * 100));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-canvas/80 backdrop-blur-[3px] rise" />
      <div className="sheet rise relative w-[min(480px,92vw)] px-9 py-8">
        <div className="text-xxs uppercase tracking-[0.14em] text-ink-faint">
          Keepr · workflow
        </div>
        <div className="display-serif-lg mt-2 text-[30px] leading-[1.1] text-ink">
          {isError
            ? "Something went sideways."
            : isDone
            ? "Ready."
            : `${LABELS[state.stage]}…`}
        </div>
        {state.detail && !isError && (
          <div className="mt-3 text-sm text-ink-muted breathing">
            {state.detail}
          </div>
        )}
        {state.error && (
          <div className="mt-3 text-sm text-ink-soft">
            <span className="text-ink-muted">Error: </span>
            {state.error}
          </div>
        )}

        <div className="mt-7 h-[2px] w-full overflow-hidden rounded-full bg-[rgba(10,10,10,0.06)]">
          <div
            className="h-full bg-ink transition-[width] duration-[800ms] ease-calm"
            style={{
              width: `${pct}%`,
              opacity: isError ? 0.35 : 1,
            }}
          />
        </div>
        <div className="mt-3 flex justify-between">
          {STAGES.map((s, i) => {
            const reached = i <= stageIndex && !isError;
            return (
              <span
                key={s}
                className={`text-[10px] uppercase tracking-[0.08em] transition-colors duration-300 ${
                  reached ? "text-ink-muted" : "text-ink-ghost"
                }`}
              >
                {LABELS[s]}
              </span>
            );
          })}
        </div>

        {(isDone || isError) && (
          <div className="mt-7 flex justify-end gap-2">
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
