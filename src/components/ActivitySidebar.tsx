// ActivitySidebar — live activity feed for the ctxd memory layer.
//
// v0.2.7 PR 9: scaffolding. memory_subscribe is stubbed against the v0.3.0
// ctxd SDK (see src-tauri/src/memory/client.rs), so the sidebar shows a
// "live updates coming soon in v0.4" preview rather than real events.
// When the SDK gains a real EventStream and we wire it through Tauri's
// event-emit bridge, this component starts streaming without a contract
// change to the rest of the app.
//
// Default-collapsed. Toggled by a small edge-button; opens to ~320px.

import { useEffect, useState } from "react";
import {
  isTransientError,
  memorySubscribe,
  type SubscribeStub,
} from "../services/ctxStore";

interface Props {
  /** Optional override; v0.2.7 always returns the stub anyway. */
  pattern?: string;
}

const DEFAULT_PATTERN = "/keepr/**";

type SubscribeStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "stub"; stub: SubscribeStub }
  | { kind: "offline" }
  | { kind: "error"; message: string };

export function ActivitySidebar({ pattern = DEFAULT_PATTERN }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<SubscribeStatus>({ kind: "idle" });

  useEffect(() => {
    if (!open) {
      setStatus({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setStatus({ kind: "loading" });
    (async () => {
      try {
        const stub = await memorySubscribe(pattern);
        if (cancelled) return;
        setStatus({ kind: "stub", stub });
      } catch (err) {
        if (cancelled) return;
        if (isTransientError(err)) {
          setStatus({ kind: "offline" });
        } else {
          setStatus({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : (err as { message?: string })?.message || "Subscribe failed.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pattern]);

  return (
    <>
      {/* Edge toggle — always visible, fixed top-right under the titlebar. */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close activity sidebar" : "Open activity sidebar"}
        aria-expanded={open}
        className="fixed top-12 right-3 z-30 rounded border border-hairline bg-canvas px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-ink-faint hover:text-ink hover:border-ink/40 transition-colors duration-180"
      >
        {open ? "× activity" : "activity ▸"}
      </button>

      {open && (
        <aside
          className="fixed top-0 right-0 z-30 h-full w-[min(320px,90vw)] bg-canvas border-l border-hairline shadow-[-2px_0_8px_rgba(0,0,0,0.04)] flex flex-col"
          aria-label="Memory activity sidebar"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
            <div>
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                Activity
              </div>
              <div className="mt-1 text-xs text-ink-soft">{pattern}</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Dismiss activity panel"
              className="ml-4 text-ink-faint hover:text-ink text-base"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {status.kind === "loading" && (
              <div className="text-xs text-ink-faint">Connecting…</div>
            )}
            {status.kind === "offline" && (
              <Hint
                title="Memory layer offline"
                note="The local memory daemon isn't responding. Open Settings → Memory layer to retry."
              />
            )}
            {status.kind === "error" && (
              <Hint title="Couldn't connect" note={status.message} />
            )}
            {status.kind === "stub" && <StubPreview note={status.stub.note} />}
          </div>
        </aside>
      )}
    </>
  );
}

function Hint({ title, note }: { title: string; note: string }) {
  return (
    <div className="py-6 text-center">
      <div className="display-serif text-[15px] text-ink-muted">{title}</div>
      <div className="mt-1 text-[11px] text-ink-faint">{note}</div>
    </div>
  );
}

function StubPreview({ note }: { note: string }) {
  // Until v0.4 SDK lands the real EventStream, show users what the live
  // feed will look like + the kind of events they'll see. Intentionally
  // human-friendly — not technical jargon.
  return (
    <div>
      <div className="rounded-md border border-hairline px-3 py-2 text-[11px] text-ink-faint">
        <div className="mb-1 uppercase tracking-[0.12em] text-[9.5px] text-ink-muted">
          Coming in v0.4
        </div>
        Live activity stream lands when the ctxd SDK exposes its
        EventStream API. Until then, refresh MemorySearch to see the
        latest events.
      </div>

      <div className="mt-5 mb-2 px-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        What you'll see
      </div>
      <ul className="space-y-2 px-1 text-[11px] text-ink-soft">
        {PREVIEW_ROWS.map((p) => (
          <li key={p.label} className="flex items-start gap-2">
            <span className="mt-[3px] shrink-0 w-12 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              {p.kind}
            </span>
            <span className="flex-1">{p.label}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6 px-1 text-[10px] text-ink-ghost">
        debug — {note}
      </div>
    </div>
  );
}

const PREVIEW_ROWS: Array<{ kind: string; label: string }> = [
  { kind: "github", label: "Pull request opened, merged, or reviewed" },
  { kind: "session", label: "Pulse, 1:1 prep, or weekly update completed" },
  { kind: "person", label: "Fact recorded for a teammate from a session" },
  { kind: "follow-up", label: "Follow-up opened or carried" },
  { kind: "topic", label: "Topic note added or updated" },
];
