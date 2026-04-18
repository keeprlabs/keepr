// Team heatmap screen — grid of member × day activity intensity.

import { useCallback, useEffect, useState } from "react";
import type { EvidenceItem, TeamMember } from "../lib/types";
import { listEvidence, listSessions } from "../services/db";
import HeatmapGrid from "../features/team-heatmap/HeatmapGrid";
import HeatmapPanel from "../features/team-heatmap/HeatmapPanel";

interface Props {
  members: TeamMember[];
}

export function TeamHeatmap({ members }: Props) {
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [days, setDays] = useState(14);
  const [selectedCell, setSelectedCell] = useState<{
    memberId: number;
    date: string;
  } | null>(null);

  // Load all evidence from recent sessions.
  useEffect(() => {
    (async () => {
      const sessions = await listSessions(100);
      const allEvidence: EvidenceItem[] = [];
      for (const s of sessions) {
        if (s.status !== "complete") continue;
        const ev = await listEvidence(s.id);
        allEvidence.push(...ev);
      }
      setEvidence(allEvidence);
    })();
  }, []);

  const handleCellClick = useCallback(
    (memberId: number, date: string) => {
      setSelectedCell((prev) =>
        prev?.memberId === memberId && prev?.date === date
          ? null
          : { memberId, date }
      );
    },
    []
  );

  // Filter evidence for the selected cell.
  const cellEvidence = selectedCell
    ? evidence.filter((ev) => {
        if (ev.actor_member_id !== selectedCell.memberId) return false;
        const evDate = new Date(ev.timestamp_at).toISOString().slice(0, 10);
        return evDate === selectedCell.date;
      })
    : [];

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto px-12 pt-14 pb-10">
        <div className="mx-auto max-w-[960px]">
          <div className="mb-2 text-xxs uppercase tracking-[0.14em] text-ink-faint">
            Team view
          </div>
          <h1 className="display-serif-lg mb-8 text-[36px] leading-[1.1] text-ink">
            Activity heatmap
          </h1>

          <HeatmapGrid
            evidence={evidence}
            members={members}
            days={days}
            rangeEnd={new Date().toISOString()}
            onCellClick={handleCellClick}
            onMemberClick={() => {}}
          />
        </div>
      </div>

      {selectedCell && (
        <div className="w-[380px] flex-shrink-0 overflow-y-auto border-l border-hairline bg-canvas px-6 pt-14 pb-10">
          <HeatmapPanel
            memberId={selectedCell.memberId}
            date={selectedCell.date}
            evidence={cellEvidence}
            members={members}
            onClose={() => setSelectedCell(null)}
          />
        </div>
      )}
    </div>
  );
}
