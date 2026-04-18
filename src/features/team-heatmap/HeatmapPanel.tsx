import type { EvidenceItem, TeamMember } from "../../lib/types";
import { EvidenceCard } from "../evidence-cards/EvidenceCard";

interface HeatmapPanelProps {
  memberId: number;
  date: string;
  evidence: EvidenceItem[];
  members: TeamMember[];
  onClose: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function HeatmapPanel({
  memberId,
  date,
  evidence,
  members,
  onClose,
}: HeatmapPanelProps) {
  const member = members.find((m) => m.id === memberId);
  const memberName = member?.display_name ?? "Unknown";

  return (
    <aside
      className="flex h-full flex-col border-l"
      style={{
        borderColor: "var(--hairline)",
        backgroundColor: "var(--canvas)",
        width: 380,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--hairline)" }}
      >
        <div className="flex flex-col gap-0.5">
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--ink)" }}
          >
            {memberName}
          </span>
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {formatDate(date)}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-[180ms] hover:bg-[var(--ink-ghost)]"
          aria-label="Close panel"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M3 3l8 8M11 3l-8 8"
              stroke="var(--ink-soft)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Evidence list */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {evidence.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-2 py-12 text-center"
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="16"
                cy="16"
                r="12"
                stroke="var(--ink-faint)"
                strokeWidth="1.5"
              />
              <path
                d="M12 16h8"
                stroke="var(--ink-faint)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
              No activity recorded for this day.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {evidence.map((item) => (
              <li key={item.id}>
                <EvidenceCard evidence={item} members={members} compact />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
