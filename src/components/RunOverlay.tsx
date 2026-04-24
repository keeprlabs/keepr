// Progress overlay during a workflow run. Renders four terminal states
// (ready / empty / partial_failure / total_failure) plus the running
// progression. See tasks/pulse-outcome-states.md for the state matrix.
//
// The overlay has two independent axes:
//
//   stage          — running progress (fetch/prune/.../write) OR done/error
//   outcome        — the typed PulseOutcome from pipeline.runWorkflow(), set
//                    once the run terminates non-abortively
//
// When `outcome` is set we render the outcome layout (and hide the stage
// checklist — it's process UI meant for the running state). Otherwise the
// existing running/done/error progression renders as before.

import { useEffect, useRef, useState } from "react";
import type {
  IntegrationKind,
  PulseOutcome,
  SourceKindStatus,
} from "../services/pulseOutcome";

export interface RunState {
  stage: "fetch" | "prune" | "map" | "synthesize" | "write" | "done" | "error";
  detail?: string;
  error?: string;
  /** Typed terminal result from runWorkflow(). When set, the outcome layout
   *  replaces the running-progress checklist. */
  outcome?: PulseOutcome | null;
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

const MAX_WINDOW_DAYS = 90;

// User-facing names per kind. Singular = the subject line ("your Slack"),
// plural = the plural count word ("channels"). Both rendered as-is.
const KIND_LABELS: Record<IntegrationKind, { subject: string; plural: string }> = {
  slack: { subject: "Slack", plural: "channels" },
  github: { subject: "GitHub", plural: "repos" },
  gitlab: { subject: "GitLab", plural: "projects" },
  jira: { subject: "Jira", plural: "projects" },
  linear: { subject: "Linear", plural: "teams" },
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
  onTryLongerWindow,
  onFixInSettings,
}: {
  state: RunState | null;
  onDismiss: () => void;
  onCancel?: () => void;
  onTryLongerWindow?: (nextDaysBack: number) => void;
  onFixInSettings?: (focusKind?: IntegrationKind) => void;
}) {
  // Hooks MUST run unconditionally. Derive everything else as locals so the
  // null-state early return below is safe under React's Rules of Hooks (a
  // null→non-null transition would otherwise change the hook call count).
  const outcome = state?.outcome ?? null;
  const isOutcomeTerminal =
    outcome !== null &&
    (outcome.kind === "empty" ||
      outcome.kind === "partial_failure" ||
      outcome.kind === "total_failure");
  const isDone = state?.stage === "done";
  const isError = state?.stage === "error";
  const isRunning = state != null && !isDone && !isError && !isOutcomeTerminal;

  const elapsed = useElapsed(isRunning);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      className="fixed inset-0 z-40 flex items-center justify-center"
    >
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

        {/* Terminal outcome view takes over when the pipeline returns a
            typed PulseOutcome. Otherwise render the running/done/error
            progression as before. */}
        {isOutcomeTerminal && outcome ? (
          <OutcomeView
            outcome={outcome}
            onDismiss={onDismiss}
            onTryLongerWindow={onTryLongerWindow}
            onFixInSettings={onFixInSettings}
          />
        ) : (
          <>
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

            {/* Step indicators — only during running/done/error, hidden
                for outcome terminal states (handled above). */}
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
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outcome view — the three terminal states from pulse-outcome-states.md.
// ---------------------------------------------------------------------------

function OutcomeView({
  outcome,
  onDismiss,
  onTryLongerWindow,
  onFixInSettings,
}: {
  outcome: Extract<
    PulseOutcome,
    { kind: "empty" | "partial_failure" | "total_failure" }
  >;
  onDismiss: () => void;
  onTryLongerWindow?: (nextDaysBack: number) => void;
  onFixInSettings?: (focusKind?: IntegrationKind) => void;
}) {
  const { title, body } = outcomeCopy(outcome);
  const severity: "warn" | "danger" =
    outcome.kind === "total_failure" ? "danger" : "warn";

  const nextWindow = Math.min(outcome.windowDays * 2, MAX_WINDOW_DAYS);
  const atWindowMax = outcome.windowDays >= MAX_WINDOW_DAYS;
  const showTryLonger = outcome.kind !== "total_failure";
  const showFix = outcome.kind !== "empty";
  // On empty, the secondary action is "Adjust sources" which also points
  // to Settings but with no kind focus. On partial_failure with one broken
  // kind, focus that kind's panel.
  const singleBrokenKind = onlyBrokenKind(outcome);
  const maxedLabel = `Already at the max ${MAX_WINDOW_DAYS}-day window.`;

  // Move keyboard focus to the primary action once the outcome view
  // mounts. Keyboard users arriving from a running → outcome transition
  // should immediately land on the first meaningful affordance.
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  return (
    <div>
      <h2 className="display-serif-lg text-[28px] leading-[1.1] text-ink">
        {title}
      </h2>
      <p className="mt-3 text-sm text-ink-soft">{body}</p>

      <ul role="list" className="mt-8 flex flex-col gap-0">
        {outcome.sources.map((s) => (
          <SourceRow key={s.kind} status={s} severity={severity} />
        ))}
      </ul>

      {/* Action row — primary on the left, Dismiss floats right (de-emphasized
          text button) per the wireframe hierarchy. Order within the left
          group: empty → [Try N] [Adjust sources]; partial → [Fix] [Try N];
          total → [Fix]. */}
      <div className="mt-8 flex items-center gap-2">
        {outcome.kind === "empty" && showTryLonger && (
          <button
            ref={primaryRef}
            onClick={() => !atWindowMax && onTryLongerWindow?.(nextWindow)}
            disabled={atWindowMax}
            aria-label={atWindowMax ? maxedLabel : undefined}
            title={atWindowMax ? maxedLabel : undefined}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors duration-180 hover:bg-ink-soft disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {atWindowMax ? `${MAX_WINDOW_DAYS} days max` : `Try ${nextWindow} days`}
          </button>
        )}
        {outcome.kind === "empty" && (
          <button
            onClick={() => onFixInSettings?.()}
            className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink-soft transition-colors duration-180 hover:border-ink/25 hover:text-ink"
          >
            Adjust sources
          </button>
        )}
        {showFix && (
          <button
            ref={primaryRef}
            onClick={() => onFixInSettings?.(singleBrokenKind)}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas transition-colors duration-180 hover:bg-ink-soft"
          >
            Fix in Settings
          </button>
        )}
        {outcome.kind !== "empty" && showTryLonger && (
          <button
            onClick={() => !atWindowMax && onTryLongerWindow?.(nextWindow)}
            disabled={atWindowMax}
            aria-label={atWindowMax ? maxedLabel : undefined}
            title={atWindowMax ? maxedLabel : undefined}
            className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink-soft transition-colors duration-180 hover:border-ink/25 hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {atWindowMax ? `${MAX_WINDOW_DAYS} days max` : `Try ${nextWindow} days`}
          </button>
        )}
        <button
          onClick={onDismiss}
          className="ml-auto text-xs text-ink-faint hover:text-ink transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-source row — composition only, state comes from PulseOutcome.
// ---------------------------------------------------------------------------

function SourceRow({
  status,
  severity,
}: {
  status: SourceKindStatus;
  severity: "warn" | "danger";
}) {
  const { subject, plural } = KIND_LABELS[status.kind];
  const countLabel = `${status.sourceCount} ${plural}`;

  const { glyph, tone, detail, ariaLabel } = rowViz(status, severity);

  return (
    <li
      role="listitem"
      aria-label={`${subject}, ${countLabel}, ${ariaLabel}`}
      className="flex items-center gap-4 py-[7px]"
    >
      <div
        className={`flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${tone}`}
        aria-hidden
      >
        {glyph}
      </div>
      <span className="mono text-xs uppercase tracking-[0.14em] text-ink-muted w-16">
        {subject}
      </span>
      <span className="mono text-xxs uppercase tracking-[0.1em] text-ink-faint w-24">
        {countLabel}
      </span>
      <span className="text-xs text-ink-soft flex-1 leading-snug">{detail}</span>
    </li>
  );
}

// Visual / a11y mapping for a single row based on status + outcome severity.
function rowViz(
  status: SourceKindStatus,
  severity: "warn" | "danger"
): {
  glyph: React.ReactNode;
  tone: string;
  detail: string;
  ariaLabel: string;
} {
  if (status.status === "ok_data") {
    const n = status.itemCount;
    const detail = `${n} item${n === 1 ? "" : "s"} collected`;
    return { glyph: <Check />, tone: "bg-ink", detail, ariaLabel: `ok, ${detail}` };
  }
  if (status.status === "ok_empty") {
    return {
      glyph: <Check />,
      tone: "bg-ink-soft/30",
      detail: status.detail,
      ariaLabel: `ok, ${status.detail}`,
    };
  }
  // error
  if (severity === "danger") {
    return {
      glyph: <Cross />,
      tone: "bg-ink/15",
      detail: status.detail,
      ariaLabel: `error, ${status.detail}`,
    };
  }
  return {
    glyph: <Warn />,
    tone: "bg-ink-soft/25",
    detail: status.detail,
    ariaLabel: `warning, ${status.detail}`,
  };
}

function Check() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M2.5 6L5 8.5L9.5 3.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Cross() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M3 3l6 6M9 3l-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Warn() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M6 2L10.5 10H1.5L6 2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M6 5.5V7"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="6" cy="8.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Copy selection
// ---------------------------------------------------------------------------

function outcomeCopy(
  outcome: Extract<
    PulseOutcome,
    { kind: "empty" | "partial_failure" | "total_failure" }
  >
): { title: string; body: string } {
  if (outcome.kind === "empty") {
    return {
      title: "Quiet week.",
      body: `Keepr checked ${listKinds(outcome.sources)} for the last ${
        outcome.windowDays
      } days. Nothing new to summarize.`,
    };
  }
  if (outcome.kind === "total_failure") {
    return {
      title: "Keepr couldn't reach any sources.",
      body: "Every source returned an error. Usually this means a token expired or you're offline.",
    };
  }
  // partial_failure
  const brokenKinds = outcome.sources.filter((s) => s.status === "error");
  if (brokenKinds.length === 1) {
    const k = brokenKinds[0].kind;
    return {
      title: `Couldn't reach your ${KIND_LABELS[k].subject}.`,
      body: `Keepr ran, but the ${KIND_LABELS[k].plural} returned an error. The other sources were quiet for the last ${outcome.windowDays} days.`,
    };
  }
  return {
    title: `Couldn't reach ${brokenKinds.length} of your sources.`,
    body: `Some sources returned errors; others were quiet for the last ${outcome.windowDays} days.`,
  };
}

function listKinds(sources: SourceKindStatus[]): string {
  // "5 repos, 9 channels, 4 projects, and 1 team"
  const parts = sources.map(
    (s) => `${s.sourceCount} ${KIND_LABELS[s.kind].plural}`
  );
  if (parts.length === 0) return "your sources";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function onlyBrokenKind(
  outcome: Extract<
    PulseOutcome,
    { kind: "empty" | "partial_failure" | "total_failure" }
  >
): IntegrationKind | undefined {
  const broken = outcome.sources.filter((s) => s.status === "error");
  if (broken.length === 1) return broken[0].kind;
  return undefined;
}
