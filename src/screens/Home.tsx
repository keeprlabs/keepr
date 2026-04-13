// Home screen — a composed empty state that whispers the next action.
// Generous whitespace, confident serif headline, one primary path forward.

import type { TeamMember } from "../lib/types";

interface Props {
  lastPulse: string | null;
  onOpenPalette: () => void;
  onRunTeamPulse: () => void;
  onRunWeeklyUpdate: () => void;
  onRunOneOnOne: (m: TeamMember) => void;
  members: TeamMember[];
}

export function Home({
  lastPulse,
  onOpenPalette,
  onRunTeamPulse,
  onRunWeeklyUpdate,
  onRunOneOnOne,
  members,
}: Props) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[680px] px-12 pt-[18vh] pb-24 rise">
        <div className="flex items-center gap-3 text-xxs uppercase tracking-[0.14em] text-ink-faint">
          <span>{greet()}</span>
          <span className="text-ink-ghost">·</span>
          <span>
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
        </div>

        <h1 className="display-serif-lg mt-6 text-[52px] leading-[1.04] text-ink">
          A quiet read on your team,
          <br />
          <span className="text-ink-muted">whenever you need one.</span>
        </h1>

        <p className="mt-7 max-w-[52ch] text-md text-ink-muted">
          Keepr reads your Slack, GitHub, Jira, and Linear, prunes the noise, and writes you a
          short brief. Press{" "}
          <button
            onClick={onOpenPalette}
            className="inline-flex items-center gap-1 rounded-md border border-hairline bg-canvas px-1.5 py-[1px] text-[11px] text-ink-soft align-[1px] transition-colors duration-180 hover:border-ink/25 hover:text-ink"
          >
            <span className="mono">⌘K</span>
          </button>{" "}
          to run a workflow, or pick one below.
        </p>

        <div className="mt-14 flex flex-col gap-[2px]">
          <ActionRow
            label="Team pulse"
            detail="Last 7 days · blockers, wins, who's stretched thin"
            shortcut="⌘⏎"
            onClick={onRunTeamPulse}
            primary
          />
          <ActionRow
            label="Weekly engineering update"
            detail="Shipped, in progress, blocked · shareable with stakeholders"
            onClick={onRunWeeklyUpdate}
          />
          {members.length === 0 ? (
            <ActionRow
              label="1:1 prep"
              detail="Add team members in Settings to begin"
              disabled
            />
          ) : (
            members.slice(0, 6).map((m) => (
              <ActionRow
                key={m.id}
                label={`1:1 prep — ${m.display_name}`}
                detail={`Last week with ${m.display_name.split(" ")[0]}`}
                onClick={() => onRunOneOnOne(m)}
              />
            ))
          )}
        </div>

        {lastPulse && (
          <p className="mt-12 text-xxs text-ink-faint">
            Last team pulse · {lastPulse}
          </p>
        )}
      </div>
    </div>
  );
}

function ActionRow({
  label,
  detail,
  shortcut,
  onClick,
  primary,
  disabled,
}: {
  label: string;
  detail: string;
  shortcut?: string;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group flex w-full items-center gap-4 rounded-md px-3 py-3.5 text-left transition-colors duration-180 ease-calm ${
        disabled
          ? "cursor-default opacity-60"
          : "hover:bg-[rgba(10,10,10,0.035)]"
      }`}
    >
      <span
        className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full transition-all duration-180 ${
          primary
            ? "bg-ink"
            : "bg-ink-ghost group-hover:bg-ink"
        }`}
      />
      <span className="flex-1 min-w-0">
        <span
          className={`block truncate text-[15px] ${
            primary ? "text-ink font-medium" : "text-ink-soft"
          }`}
        >
          {label}
        </span>
        <span className="mt-[2px] block truncate text-xs text-ink-faint">
          {detail}
        </span>
      </span>
      {shortcut && (
        <span className="mono shrink-0 text-[10px] text-ink-ghost transition-colors duration-180 group-hover:text-ink-muted">
          {shortcut}
        </span>
      )}
      <span
        className={`shrink-0 text-ink-ghost transition-all duration-180 group-hover:translate-x-[2px] group-hover:text-ink ${
          disabled ? "opacity-0" : ""
        }`}
        aria-hidden
      >
        →
      </span>
    </button>
  );
}

function greet() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
