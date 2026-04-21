// Thread graph screen — relationship visualization between evidence items.

import { useEffect, useState } from "react";
import type { EvidenceItem, TeamMember } from "../lib/types";
import { listEvidence, listSessions } from "../services/db";
import { GraphView } from "../features/thread-graph/GraphView";

interface Props {
  members: TeamMember[];
}

export function ThreadGraph({ members }: Props) {
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);

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
      // Deduplicate across sessions: keep newest per source+source_id
      const deduped = new Map<string, EvidenceItem>();
      for (const ev of allEvidence) {
        const key = `${ev.source}:${ev.source_id}`;
        const existing = deduped.get(key);
        if (!existing || ev.timestamp_at > existing.timestamp_at) {
          deduped.set(key, ev);
        }
      }
      setEvidence(Array.from(deduped.values()));
    })();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="px-12 pt-14 pb-4">
        <div className="mx-auto max-w-[960px]">
          <div className="mb-2 text-xxs uppercase tracking-[0.14em] text-ink-faint">
            Team view
          </div>
          <h1 className="display-serif-lg mb-4 text-[36px] leading-[1.1] text-ink">
            Evidence graph
          </h1>
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-12 pb-10">
        <div className="mx-auto h-full max-w-[960px]">
          <GraphView evidence={evidence} members={members} />
        </div>
      </div>
    </div>
  );
}
