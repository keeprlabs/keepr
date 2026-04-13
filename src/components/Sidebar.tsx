// Sidebar. Table-of-contents aesthetic: no boxes, no chrome, just typography.
// Reads as an index of the workspace — quiet sections, tight rhythm, one
// active row at a time.

import type { SessionRow, TeamMember } from "../lib/types";
import wordmarkSvg from "../assets/wordmark.svg";

export type ViewKey =
  | { kind: "home" }
  | { kind: "session"; id: number }
  | { kind: "memory"; file: "status" | "memory" }
  | { kind: "person"; memberId: number }
  | { kind: "topic"; slug: string }
  | { kind: "settings" }
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
          className={`mb-7 flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left transition-colors duration-180 ${
            view.kind === "home" ? "text-ink" : "text-ink-soft hover:text-ink"
          }`}
        >
          <img src={wordmarkSvg} alt="Keepr" className="h-[17px]" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            home
          </span>
        </button>

        <Section
          label="Sessions"
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

        <Section label="People" count={members.length}>
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

        <Section label="Memory">
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
          <Section label="Topics" count={topics.length}>
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
      </div>

      <div className="hair-t px-5 py-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          Connected
        </div>
        <div className="flex flex-col gap-1.5">
          {["anthropic", "github", "slack", "jira", "linear"].map((p) => {
            const integ = integrations.find((i) => i.provider === p);
            const state = integ?.status === "active" ? "ok" : integ ? "warn" : "off";
            return (
              <div
                key={p}
                className="flex items-center justify-between text-xs text-ink-muted"
              >
                <span className="capitalize">{p}</span>
                <StatusDot state={state} />
              </div>
            );
          })}
        </div>
        <button
          onClick={() => onSelect({ kind: "settings" })}
          className={`mt-4 flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors duration-180 ${
            view.kind === "settings"
              ? "text-ink"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          <span>Settings</span>
          <span className="mono text-[10px] text-ink-faint">⌘,</span>
        </button>
      </div>
    </aside>
  );
}

function Section({
  label,
  count,
  suffix,
  children,
}: {
  label: string;
  count?: number;
  suffix?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          {label}
        </span>
        <span className="flex items-center gap-2">
          {suffix}
          {typeof count === "number" && count > 0 && (
            <span className="mono text-[10px] tabular-nums text-ink-faint">
              {count}
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-[1px]">{children}</div>
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

function StatusDot({ state }: { state: "ok" | "warn" | "off" }) {
  // Monochromatic: a filled ink dot for connected, a hollow ring for
  // warn, and an empty trace for disconnected. No stray brand colors.
  if (state === "ok") {
    return <span className="h-1.5 w-1.5 rounded-full bg-ink" />;
  }
  if (state === "warn") {
    return (
      <span className="h-1.5 w-1.5 rounded-full border border-ink/50 bg-transparent" />
    );
  }
  return <span className="h-1.5 w-1.5 rounded-full border border-ink/15 bg-transparent" />;
}

function formatShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}
