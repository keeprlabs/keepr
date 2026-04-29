// Sidebar. Table-of-contents aesthetic: no boxes, no chrome, just typography.
// Reads as an index of the workspace — quiet sections, tight rhythm, one
// active row at a time.

import { useState } from "react";
import type { SessionRow, TeamMember } from "../lib/types";
import { providerIcon } from "./primitives/SourceBadge";


import type { IntegrationKind } from "../services/pulseOutcome";

export type ViewKey =
  | { kind: "home" }
  | { kind: "session"; id: number }
  | { kind: "memory"; file: "status" | "memory" }
  | { kind: "person"; memberId: number }
  | { kind: "topic"; slug: string }
  | { kind: "followups" }
  | { kind: "heatmap" }
  | { kind: "graph" }
  /** v0.2.7+: full-results screen for the memory layer (ctxd).
   *  - `q` initial search text (optional).
   *  - `subject` initial subject prefix filter (optional). When set
   *    from the cmd+k palette, scopes results to events under that
   *    subject branch. */
  | { kind: "memory_search"; q?: string; subject?: string }
  | {
      kind: "settings";
      /** When navigating from the RunOverlay "Fix in Settings" button with
       *  a single broken integration kind, scroll that panel into view on
       *  mount. */
      focusKind?: IntegrationKind;
    }
  | { kind: "onboarding" };

interface Props {
  sessions: SessionRow[];
  members: TeamMember[];
  topics: string[];
  view: ViewKey;
  onSelect: (v: ViewKey) => void;
  integrations: Array<{ provider: string; status: string }>;
  archivedCount: number;
  showArchived: boolean;
  onToggleArchived: () => void;
  onArchive: (id: number) => void;
  onUnarchive: (id: number) => void;
}

const WORKFLOW_LABELS: Record<string, string> = {
  team_pulse: "Team pulse",
  one_on_one_prep: "1:1 prep",
  weekly_update: "Weekly update",
  perf_evaluation: "Perf eval",
  promo_readiness: "Promo readiness",
};

export function Sidebar({ sessions, members, topics, view, onSelect, integrations, archivedCount, showArchived, onToggleArchived, onArchive, onUnarchive }: Props) {
  return (
    <aside className="hair-r w-[244px] flex-shrink-0 bg-canvas flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-5 pt-7 pb-4">
        <button
          onClick={() => onSelect({ kind: "home" })}
          className={`mb-5 flex w-full items-center gap-2.5 rounded-md px-2 py-[5px] text-left text-sm transition-colors duration-180 ${
            view.kind === "home" ? "text-ink" : "text-ink-soft hover:text-ink"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
            <path d="M3 7.5L8 3l5 4.5V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Home
        </button>

        <Section
          label="Sessions"
          defaultOpen={false}
          icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden><rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M5 6.5h6M5 9.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>}
          count={sessions.length}
          suffix={
            archivedCount > 0 ? (
              <button
                onClick={onToggleArchived}
                className="text-[10px] tabular-nums text-ink-faint hover:text-ink-muted transition-colors duration-180"
              >
                {showArchived ? "hide archived" : `${archivedCount} archived`}
              </button>
            ) : undefined
          }
        >
          {sessions.length === 0 && <EmptyHint>No sessions yet</EmptyHint>}
          {sessions.slice(0, 15).map((s) => {
              const isArchived = !!s.archived_at;
              const baseLabel = WORKFLOW_LABELS[s.workflow_type] || s.workflow_type;
              const member = s.target_member_id
                ? members.find((m) => m.id === s.target_member_id)
                : null;
              const label = member
                ? `${baseLabel} — ${member.display_name}`
                : baseLabel;
              return (
                <Item
                  key={s.id}
                  active={view.kind === "session" && view.id === s.id}
                  onClick={() => onSelect({ kind: "session", id: s.id })}
                  label={label}
                  meta={formatShort(s.created_at)}
                  sub={s.status !== "complete" ? s.status : undefined}
                  dimmed={isArchived}
                  onDismiss={() =>
                    isArchived ? onUnarchive(s.id) : onArchive(s.id)
                  }
                  dismissLabel={isArchived ? "restore" : "archive"}
                />
              );
          })}
        </Section>

        <Section label="People" defaultOpen={true} icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3" /><path d="M3 14c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>} count={members.length}>
          {members.length === 0 && (
            <EmptyHint>Add members in Settings</EmptyHint>
          )}
          {members.map((m) => (
            <Item
              key={m.id}
              active={view.kind === "person" && view.memberId === m.id}
              onClick={() => onSelect({ kind: "person", memberId: m.id })}
              label={m.display_name}
            />
          ))}
        </Section>

        <Section label="Memory" defaultOpen={false} icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M8 2C5 2 3 3.5 3 5v6c0 1.5 2 3 5 3s5-1.5 5-3V5c0-1.5-2-3-5-3z" stroke="currentColor" strokeWidth="1.3" /><path d="M3 8c0 1.5 2 3 5 3s5-1.5 5-3" stroke="currentColor" strokeWidth="1.3" /></svg>}>
          <Item
            active={view.kind === "memory" && view.file === "status"}
            onClick={() => onSelect({ kind: "memory", file: "status" })}
            label="status.md"
          />
          <Item
            active={view.kind === "memory" && view.file === "memory"}
            onClick={() => onSelect({ kind: "memory", file: "memory" })}
            label="memory.md"
          />
        </Section>

        {topics.length > 0 && (
          <Section label="Topics" defaultOpen={false} count={topics.length}>
            {topics.map((t) => (
              <Item
                key={t}
                active={view.kind === "topic" && view.slug === t}
                onClick={() => onSelect({ kind: "topic", slug: t })}
                label={t.replace(/-/g, " ")}
              />
            ))}
          </Section>
        )}

        <Section
          label="Tools"
          defaultOpen={false}
          icon={<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M6 2h4M7 2v4l-3.5 6a1 1 0 0 0 .87 1.5h7.26a1 1 0 0 0 .87-1.5L9 6V2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 10h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>}
        >
          <Item
            active={view.kind === "followups"}
            onClick={() => onSelect({ kind: "followups" })}
            label="Follow-ups"
          />
          <Item
            active={view.kind === "heatmap"}
            onClick={() => onSelect({ kind: "heatmap" })}
            label="Team heatmap"
          />
          <Item
            active={view.kind === "graph"}
            onClick={() => onSelect({ kind: "graph" })}
            label="Evidence graph"
          />
        </Section>
      </div>

      <div className="hair-t px-5 py-4">
        <ConnectedSection integrations={integrations} />
        <button
          onClick={() => onSelect({ kind: "settings" })}
          className={`mt-4 flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors duration-180 ${
            view.kind === "settings"
              ? "text-ink"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          <span className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M8 0.5v2.5M8 13v2.5M0.5 8H3M13 8h2.5M2.34 2.34l1.77 1.77M11.89 11.89l1.77 1.77M2.34 13.66l1.77-1.77M11.89 4.11l1.77-1.77" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Settings
          </span>
          <span className="mono text-[10px] text-ink-faint">⌘,</span>
        </button>
      </div>
    </aside>
  );
}

function Section({
  label,
  icon,
  count,
  suffix,
  defaultOpen = true,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  count?: number;
  suffix?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between px-2">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
            className={`shrink-0 transition-transform duration-180 ${open ? "" : "-rotate-90"}`}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {icon}
          {label}
        </button>
        <span className="flex items-center gap-2">
          {suffix}
          {typeof count === "number" && count > 0 && (
            <span className="mono text-[10px] tabular-nums text-ink-faint">
              {count}
            </span>
          )}
        </span>
      </div>
      {open && <div className="flex flex-col gap-[1px] pl-3">{children}</div>}
    </div>
  );
}

function Item({
  label,
  meta,
  sub,
  active,
  dimmed,
  onClick,
  onDismiss,
  dismissLabel,
}: {
  label: string;
  meta?: string;
  sub?: string;
  active?: boolean;
  dimmed?: boolean;
  onClick: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-sm transition-colors duration-180 ${
        dimmed ? "opacity-50" : ""
      } ${
        active
          ? "text-ink"
          : "text-ink-soft hover:text-ink"
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-[14px] w-[2px] -translate-y-1/2 rounded-full bg-ink" />
      )}
      <span className="flex-1 truncate">{label}</span>
      {meta && (
        <span
          className={`shrink-0 text-[10px] tabular-nums group-hover:hidden ${
            active ? "text-ink-muted" : "text-ink-faint"
          }`}
        >
          {meta}
        </span>
      )}
      {sub && <span className="shrink-0 text-[10px] italic text-ink-faint group-hover:hidden">{sub}</span>}
      {onDismiss && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onDismiss();
            }
          }}
          className="hidden shrink-0 text-[10px] text-ink-faint hover:text-ink group-hover:inline"
          title={dismissLabel}
        >
          {dimmed ? "↩" : "×"}
        </span>
      )}
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1 text-xs italic text-ink-ghost">{children}</div>
  );
}

function ConnectedSection({ integrations }: { integrations: Array<{ provider: string; status: string }> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="mb-3 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted"
      >
        <span>Connected</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className={`transition-transform duration-180 ${open ? "" : "-rotate-90"}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="mb-3 flex flex-col gap-1.5">
          {["anthropic", "github", "gitlab", "slack", "jira", "linear"].map((p) => {
            const integ = integrations.find((i) => i.provider === p);
            const state = integ?.status === "active" ? "ok" : integ ? "warn" : "off";
            const icon = providerIcon(p, 14);
            return (
              <div
                key={p}
                className="flex items-center justify-between text-xs text-ink-muted"
              >
                <span className="flex items-center gap-2 capitalize">
                  {icon}
                  {p}
                </span>
                <StatusDot state={state} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function StatusDot({ state }: { state: "ok" | "warn" | "off" }) {
  if (state === "ok") {
    return <span className="h-2 w-2 rounded-full bg-green-500" />;
  }
  if (state === "warn") {
    return <span className="h-2 w-2 rounded-full bg-amber-400" />;
  }
  return <span className="h-2 w-2 rounded-full border border-ink/15 bg-transparent" />;
}

function formatShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
