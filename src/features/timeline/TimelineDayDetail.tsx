// Day detail popover — shows all evidence for a selected timeline day.
// Renders compact EvidenceCards. Click a card triggers citation scroll sync.

import type { TeamMember } from "../../lib/types";
import { EvidenceCard } from "../evidence-cards/EvidenceCard";
import type { TimelineDay } from "./groupByDay";

interface Props {
  day: TimelineDay;
  members: TeamMember[];
  onCardClick?: (evId: string) => void;
}

export function TimelineDayDetail({ day, members, onCardClick }: Props) {
  return (
    <div
      className="max-h-[320px] overflow-y-auto rounded-lg border border-hairline bg-canvas shadow-lg"
      style={{
        width: 340,
        boxShadow:
          "0 1px 2px rgba(10,10,10,0.04), 0 12px 32px -4px rgba(10,10,10,0.14)",
      }}
    >
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint hair-b">
        {day.label} · {day.items.length} item{day.items.length !== 1 ? "s" : ""}
      </div>
      <div className="flex flex-col gap-1 p-2">
        {day.items.map((item, i) => (
          <button
            key={item.id}
            onClick={() => onCardClick?.(`ev_${i + 1}`)}
            className="text-left transition-colors duration-180 hover:bg-[rgba(10,10,10,0.025)] rounded-md"
          >
            <EvidenceCard evidence={item} members={members} compact />
          </button>
        ))}
      </div>
    </div>
  );
}
