// RelatedPanel — entity neighborhood for a ctxd subject.
//
// v0.2.7 PR 8: scaffolding + UI shape. The underlying `memory_related`
// command currently returns `NotYetSupported` because the v0.3.0 SDK
// doesn't expose `ctx_related`; the panel renders an empty state until
// the v0.4 SDK lands. When that bumps, this component starts surfacing
// real results without contract changes.
//
// Open path: triggered from MemorySearch row clicks, evidence cards
// (PR 10's pulse citations), and the cmd+k palette in v0.3.0.

import { useEffect, useState } from "react";
import {
  isEmptyResult,
  isTransientError,
  memoryRelated,
  type EventRow,
} from "../services/ctxStore";

interface Props {
  subject: string | null;
  onClose: () => void;
  onOpenSubject?: (subject: string) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; results: EventRow[] }
  | { kind: "empty" }
  | { kind: "offline" }
  | { kind: "error"; message: string }
  /** v0.2.7: SDK doesn't expose related yet; surface a quiet "coming soon"
   *  empty state instead of an error. */
  | { kind: "unsupported" };

export function RelatedPanel({ subject, onClose, onOpenSubject }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (!subject) {
      setStatus({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setStatus({ kind: "loading" });
    (async () => {
      try {
        const results = await memoryRelated(subject);
        if (cancelled) return;
        if (results.length === 0) setStatus({ kind: "empty" });
        else setStatus({ kind: "ready", results });
      } catch (err) {
        if (cancelled) return;
        if (isEmptyResult(err)) {
          // not_yet_supported is the v0.2.7 reality — show "coming soon"
          // rather than empty so users know the feature exists in the
          // roadmap, not that it failed to find anything.
          if ((err as { kind?: string })?.kind === "not_yet_supported") {
            setStatus({ kind: "unsupported" });
          } else {
            setStatus({ kind: "empty" });
          }
        } else if (isTransientError(err)) {
          setStatus({ kind: "offline" });
        } else {
          setStatus({
            kind: "error",
            message:
              err instanceof Error
                ? err.message
                : (err as { message?: string })?.message || "Unknown error",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subject]);

  if (!subject) return null;

  const grouped = status.kind === "ready" ? groupByRelation(status.results) : null;

  return (
    <aside
      className="fixed top-0 right-0 z-40 h-full w-[min(380px,90vw)] bg-canvas border-l border-hairline shadow-[-2px_0_8px_rgba(0,0,0,0.04)] flex flex-col"
      aria-label="Related memory panel"
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
        <div className="min-w-0 flex-1">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            Related memory
          </div>
          <div className="mt-1 truncate text-xs text-ink-soft">{subject}</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close related panel"
          className="ml-4 text-ink-faint hover:text-ink text-base"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {status.kind === "loading" && (
          <div className="px-4 py-6 text-xs text-ink-faint">Loading…</div>
        )}
        {status.kind === "empty" && (
          <EmptyState
            title="No related memory yet"
            note="Nothing else in the memory layer references this subject."
          />
        )}
        {status.kind === "unsupported" && (
          <EmptyState
            title="Coming soon"
            note="Cross-source links arrive in v0.4 when the ctxd SDK exposes ctx_related."
          />
        )}
        {status.kind === "offline" && (
          <EmptyState
            title="Memory layer offline"
            note="The local memory daemon isn't responding. Try again in a moment."
          />
        )}
        {status.kind === "error" && (
          <EmptyState
            title="Something went wrong"
            note={status.message}
          />
        )}
        {status.kind === "ready" && grouped && (
          <div className="space-y-4 px-2 py-2">
            {grouped.map(([relation, events]) => (
              <section key={relation}>
                <div className="mb-1 px-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                  {relation}
                </div>
                <div className="divide-y divide-hairline">
                  {events.map((ev) => (
                    <button
                      key={ev.id}
                      onClick={() => onOpenSubject?.(ev.subject)}
                      className="flex w-full items-start gap-2 py-2 text-left hover:bg-[rgba(10,10,10,0.025)] rounded-sm transition-colors duration-180"
                    >
                      <span className="mt-[3px] shrink-0 w-12 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                        {kindLabel(ev.subject)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-ink">
                          {bestTitle(ev)}
                        </div>
                        <div className="truncate text-[10px] text-ink-faint">
                          {ev.subject}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------- helpers --------------------------------------------------

function groupByRelation(events: EventRow[]): Array<[string, EventRow[]]> {
  // The v0.4 SDK shape is unknown. For now group by event_type — ctxd's
  // `ctx_related` is expected to return events with their original types
  // and a `relation` field on the data payload. We honor `data.relation`
  // when present; else fall back to event_type.
  const groups = new Map<string, EventRow[]>();
  for (const ev of events) {
    const relationFromData =
      typeof (ev.data as Record<string, unknown> | null)?.relation === "string"
        ? ((ev.data as { relation: string }).relation as string)
        : null;
    const key = relationFromData || ev.event_type || "related";
    const arr = groups.get(key) || [];
    arr.push(ev);
    groups.set(key, arr);
  }
  return Array.from(groups.entries());
}

function kindLabel(subject: string): string {
  const parts = subject.split("/").filter(Boolean);
  if (parts[0] === "keepr") {
    if (parts[1] === "people") return "person";
    if (parts[1] === "sessions") return "session";
    if (parts[1] === "topics") return "topic";
    if (parts[1] === "followups") return "f-up";
    if (parts[1] === "status") return "status";
    if (parts[1] === "evidence") return parts[2] || "ev";
  }
  if (parts[0] === "work") return parts[1] || "work";
  return parts[0] || "ev";
}

function bestTitle(ev: EventRow): string {
  const data = ev.data as Record<string, unknown> | null | undefined;
  return String(
    (data && (data.summary || data.line || data.name || data.display_name)) ??
      ev.event_type
  );
}

function EmptyState({ title, note }: { title: string; note: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <div className="display-serif text-[15px] text-ink-muted">{title}</div>
      <div className="mt-1 text-[11px] text-ink-faint">{note}</div>
    </div>
  );
}
