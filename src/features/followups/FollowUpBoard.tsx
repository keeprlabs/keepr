// FollowUpBoard — three-column Kanban: Open | Carried | Resolved.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FollowUp, TeamMember } from "../../lib/types";
import { FollowUpCard } from "./FollowUpCard";

interface Props {
  followUps: FollowUp[];
  members: TeamMember[];
  onStateChange: (id: number, state: "open" | "carried" | "resolved") => void;
  onSelect: (id: number) => void;
  onNew?: () => void;
}

const SEVEN_DAYS = 7 * 86_400_000;
const FOURTEEN_DAYS = 14 * 86_400_000;

interface Column {
  key: string;
  label: string;
  items: FollowUp[];
}

function bucketFollowUps(followUps: FollowUp[]): Column[] {
  const now = Date.now();
  const open: FollowUp[] = [];
  const carried: FollowUp[] = [];
  const resolved: FollowUp[] = [];

  for (const fu of followUps) {
    if (fu.state === "resolved") {
      // Only show resolved items from last 14 days.
      if (fu.resolved_at) {
        const resolvedAge = now - new Date(fu.resolved_at).getTime();
        if (resolvedAge <= FOURTEEN_DAYS) resolved.push(fu);
      } else {
        // No resolved_at but state is resolved — show it.
        resolved.push(fu);
      }
    } else if (fu.state === "carried") {
      carried.push(fu);
    } else {
      // state === "open": auto-categorize to carried column if >7 days old.
      const age = now - new Date(fu.created_at).getTime();
      if (age > SEVEN_DAYS) {
        carried.push(fu);
      } else {
        open.push(fu);
      }
    }
  }

  return [
    { key: "open", label: "Open", items: open },
    { key: "carried", label: "Carried", items: carried },
    { key: "resolved", label: "Resolved", items: resolved },
  ];
}

export function FollowUpBoard({ followUps, members, onStateChange, onSelect, onNew }: Props) {
  const columns = bucketFollowUps(followUps);
  const allItems = columns.flatMap((c) => c.items);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only handle if board or a child is focused.
      if (!boardRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return;

      const idx = focusedId != null ? allItems.findIndex((f) => f.id === focusedId) : -1;

      switch (e.key) {
        case "j": {
          e.preventDefault();
          const next = idx < allItems.length - 1 ? idx + 1 : 0;
          setFocusedId(allItems[next]?.id ?? null);
          scrollToCard(allItems[next]?.id);
          break;
        }
        case "k": {
          e.preventDefault();
          const prev = idx > 0 ? idx - 1 : allItems.length - 1;
          setFocusedId(allItems[prev]?.id ?? null);
          scrollToCard(allItems[prev]?.id);
          break;
        }
        case "x": {
          if (focusedId != null) {
            e.preventDefault();
            onStateChange(focusedId, "resolved");
          }
          break;
        }
        case "c": {
          if (focusedId != null) {
            e.preventDefault();
            onStateChange(focusedId, "carried");
          }
          break;
        }
        case "e": {
          if (focusedId != null) {
            e.preventDefault();
            onSelect(focusedId);
          }
          break;
        }
        case "n": {
          e.preventDefault();
          onNew?.();
          break;
        }
      }
    },
    [focusedId, allItems, onStateChange, onSelect, onNew],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div ref={boardRef} className="flex h-full gap-4 overflow-x-auto px-4 py-4">
      {columns.map((col) => (
        <div key={col.key} className="flex w-72 shrink-0 flex-col">
          {/* Column header */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-ink-muted">
              {col.label}
            </span>
            <span className="text-[10px] tabular-nums text-ink-faint">
              {col.items.length}
            </span>
          </div>

          {/* Cards */}
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {col.items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-hairline px-3 py-6 text-center text-[11px] text-ink-faint">
                No items
              </div>
            ) : (
              col.items.map((fu) => (
                <FollowUpCard
                  key={fu.id}
                  followUp={fu}
                  members={members}
                  onStateChange={onStateChange}
                  onClick={onSelect}
                  focused={fu.id === focusedId}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function scrollToCard(id: number | undefined) {
  if (id == null) return;
  const el = document.querySelector(`[data-followup-id="${id}"]`);
  el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
