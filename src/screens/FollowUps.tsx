// Follow-ups screen — three-column board with detail panel.

import { useCallback, useEffect, useState } from "react";
import type { FollowUp, TeamMember } from "../lib/types";
import {
  listFollowUps,
  createFollowUp,
  updateFollowUpState,
  updateFollowUpSubject,
  syncFollowUpsIndex,
} from "../features/followups/FollowUpStore";
import { FollowUpBoard } from "../features/followups/FollowUpBoard";
import { FollowUpDetail } from "../features/followups/FollowUpDetail";

interface Props {
  members: TeamMember[];
}

export function FollowUps({ members }: Props) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newSubject, setNewSubject] = useState("");

  const refresh = useCallback(async () => {
    await syncFollowUpsIndex();
    setFollowUps(await listFollowUps());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleStateChange = useCallback(
    async (id: number, state: "open" | "carried" | "resolved") => {
      await updateFollowUpState(id, state);
      setFollowUps(await listFollowUps());
    },
    []
  );

  const handleSave = useCallback(
    async (id: number, subject: string, description: string) => {
      await updateFollowUpSubject(id, subject, description);
      setFollowUps(await listFollowUps());
    },
    []
  );

  const handleCreate = useCallback(async () => {
    if (!newSubject.trim()) return;
    await createFollowUp({
      subject: newSubject.trim(),
      description: "",
    });
    setNewSubject("");
    setCreating(false);
    setFollowUps(await listFollowUps());
  }, [newSubject]);

  const selected = selectedId
    ? followUps.find((f) => f.id === selectedId) || null
    : null;

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto px-12 pt-14 pb-10">
        <div className="mx-auto max-w-[960px]">
          <div className="mb-2 text-xxs uppercase tracking-[0.14em] text-ink-faint">
            Daily loop
          </div>
          <h1 className="display-serif-lg mb-8 text-[36px] leading-[1.1] text-ink">
            Follow-ups
          </h1>

          {/* New follow-up inline */}
          {creating ? (
            <div className="mb-8 flex items-center gap-2">
              <input
                autoFocus
                className="flex-1 rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-ghost focus:border-ink/40 focus:outline-none"
                placeholder="What needs following up?"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewSubject("");
                  }
                }}
              />
              <button
                onClick={handleCreate}
                className="rounded-md bg-ink px-3 py-2 text-xs font-medium text-canvas transition-colors duration-180 hover:bg-ink-soft"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewSubject("");
                }}
                className="rounded-md border border-hairline px-3 py-2 text-xs text-ink-faint transition-colors duration-180 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mb-8 rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-ink-faint transition-colors duration-180 hover:border-ink/20 hover:text-ink"
            >
              + New follow-up
            </button>
          )}

          <FollowUpBoard
            followUps={followUps}
            members={members}
            onStateChange={handleStateChange}
            onSelect={setSelectedId}
            onNew={() => setCreating(true)}
          />
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-[380px] flex-shrink-0 overflow-y-auto border-l border-hairline bg-canvas px-6 pt-14 pb-10">
          <FollowUpDetail
            followUp={selected}
            members={members}
            onSave={handleSave}
            onStateChange={handleStateChange}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}
