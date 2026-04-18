// FollowUpCard — single follow-up item for the board view.

import { useCallback } from "react";
import type { FollowUp, TeamMember } from "../../lib/types";

interface Props {
  followUp: FollowUp;
  members: TeamMember[];
  onStateChange: (id: number, state: "open" | "carried" | "resolved") => void;
  onClick: (id: number) => void;
  focused?: boolean;
}

const STATE_LABELS: Record<FollowUp["state"], string> = {
  open: "Open",
  carried: "Carried",
  resolved: "Resolved",
};

const NEXT_STATE: Record<FollowUp["state"], FollowUp["state"][]> = {
  open: ["carried", "resolved"],
  carried: ["open", "resolved"],
  resolved: ["open", "carried"],
};

export function FollowUpCard({ followUp, members, onStateChange, onClick, focused }: Props) {
  const age = getAgeDays(followUp.created_at);
  const ageLabel = formatAge(age);
  const urgencyClass = followUp.state !== "resolved" ? urgencyColor(age) : "text-ink-faint";

  const member = followUp.origin_member_id
    ? members.find((m) => m.id === followUp.origin_member_id)
    : null;

  const handleStateClick = useCallback(
    (e: React.MouseEvent, state: FollowUp["state"]) => {
      e.stopPropagation();
      onStateChange(followUp.id, state);
    },
    [followUp.id, onStateChange],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(followUp.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick(followUp.id);
      }}
      data-followup-id={followUp.id}
      className={`group cursor-pointer rounded-lg border bg-canvas px-3 py-2.5 transition-shadow duration-180 ease-[cubic-bezier(.4,.0,.2,1)] hover:shadow-sm ${
        focused ? "border-accent/40 shadow-sm" : "border-hairline"
      }`}
    >
      {/* Subject */}
      <div className="text-sm font-medium text-ink-soft leading-snug line-clamp-2">
        {followUp.subject}
      </div>

      {/* Description preview */}
      {followUp.description && (
        <div className="mt-1 text-[11px] leading-relaxed text-ink-muted line-clamp-2">
          {followUp.description}
        </div>
      )}

      {/* Meta row: age + member */}
      <div className="mt-2 flex items-center gap-2">
        <span className={`text-[10px] tabular-nums font-medium ${urgencyClass}`}>
          {ageLabel}
        </span>
        {member && (
          <span className="text-[10px] text-ink-faint truncate">
            {member.display_name}
          </span>
        )}
      </div>

      {/* State toggles */}
      <div className="mt-2 flex gap-1">
        {NEXT_STATE[followUp.state].map((s) => (
          <button
            key={s}
            onClick={(e) => handleStateClick(e, s)}
            className="rounded-md border border-hairline px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-faint transition-colors duration-180 hover:border-accent/30 hover:text-ink-muted"
          >
            {STATE_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Helpers ---

function getAgeDays(iso: string): number {
  try {
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  } catch {
    return 0;
  }
}

function formatAge(days: number): string {
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function urgencyColor(days: number): string {
  if (days > 30) return "text-red-600";
  if (days > 14) return "text-amber-600";
  return "text-ink-faint";
}
