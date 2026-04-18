import React, { useState, useMemo, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import type { EvidenceItem, TeamMember } from "../../lib/types";
import HeatmapCell from "./HeatmapCell";

interface HeatmapGridProps {
  evidence: EvidenceItem[];
  members: TeamMember[];
  days: number;
  rangeEnd?: string;
  onCellClick: (memberId: number, date: string) => void;
  onMemberClick: (memberId: number) => void;
}

const DAY_OPTIONS = [7, 14, 28] as const;

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Format an ISO date to a short label. For 7-day range show day name, otherwise show MM/DD. */
function formatDayLabel(dateStr: string, useDayName: boolean): string {
  const d = new Date(dateStr + "T00:00:00");
  if (useDayName) return SHORT_DAYS[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Generate an array of ISO date strings going back `count` days from `end` (inclusive). */
function generateDates(end: string, count: number): string[] {
  const dates: string[] = [];
  const endDate = new Date(end + "T00:00:00");
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/** Extract the date portion (YYYY-MM-DD) from a timestamp string. */
function toDateKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}

export default function HeatmapGrid({
  evidence,
  members,
  days: initialDays,
  rangeEnd,
  onCellClick,
  onMemberClick,
}: HeatmapGridProps) {
  const [days, setDays] = useState(initialDays);
  const [focusedCell, setFocusedCell] = useState<[number, number] | null>(null);
  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null);
  const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const endDate = (() => {
    if (rangeEnd) {
      const d = new Date(rangeEnd + "T00:00:00");
      if (!isNaN(d.getTime())) return rangeEnd;
    }
    return new Date().toISOString().slice(0, 10);
  })();
  const dates = useMemo(() => generateDates(endDate, days), [endDate, days]);

  // Build a lookup: memberId -> dateStr -> count
  const { cellData, maxCount } = useMemo(() => {
    const map = new Map<string, number>();

    for (const item of evidence) {
      const dateKey = toDateKey(item.timestamp_at);
      const key = `${item.actor_member_id}:${dateKey}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }

    let max = 0;
    const data = new Map<string, number>();

    for (const member of members) {
      for (const date of dates) {
        const key = `${member.id}:${date}`;
        const count = map.get(key) ?? 0;
        data.set(key, count);
        if (count > max) max = count;
      }
    }

    return { cellData: data, maxCount: max };
  }, [evidence, members, dates]);

  // Check if a member has any evidence at all in the range
  const memberHasAny = useMemo(() => {
    const set = new Set<number>();
    for (const item of evidence) {
      if (item.actor_member_id != null) set.add(item.actor_member_id);
    }
    return set;
  }, [evidence]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!focusedCell) {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
          setFocusedCell([0, 0]);
          e.preventDefault();
        }
        return;
      }

      const [row, col] = focusedCell;
      let nextRow = row;
      let nextCol = col;

      switch (e.key) {
        case "ArrowUp":
          nextRow = Math.max(0, row - 1);
          break;
        case "ArrowDown":
          nextRow = Math.min(members.length - 1, row + 1);
          break;
        case "ArrowLeft":
          nextCol = Math.max(0, col - 1);
          break;
        case "ArrowRight":
          nextCol = Math.min(dates.length - 1, col + 1);
          break;
        case "Enter": {
          const member = members[row];
          const date = dates[col];
          if (member && date) {
            setSelectedCell([row, col]);
            onCellClick(member.id, date);
          }
          e.preventDefault();
          return;
        }
        case "Escape":
          setFocusedCell(null);
          setSelectedCell(null);
          e.preventDefault();
          return;
        default:
          return;
      }

      setFocusedCell([nextRow, nextCol]);
      e.preventDefault();
    },
    [focusedCell, members, dates, onCellClick],
  );

  // Scroll focused cell into view
  useEffect(() => {
    if (!focusedCell || !gridRef.current) return;
    const [row, col] = focusedCell;
    const cellEl = gridRef.current.querySelector(
      `[data-cell="${row}-${col}"]`,
    ) as HTMLElement | null;
    cellEl?.focus();
  }, [focusedCell]);

  const useDayNames = days === 7;

  return (
    <div className="flex flex-col gap-3">
      {/* Header with days selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          Team Activity
        </h3>
        <div className="flex gap-1">
          {DAY_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setDays(opt)}
              className="rounded-md px-2 py-0.5 text-xs font-medium transition-colors duration-[180ms]"
              style={{
                backgroundColor: days === opt ? "var(--ink)" : "transparent",
                color: days === opt ? "var(--canvas)" : "var(--ink-soft)",
                border: days === opt ? "none" : "1px solid var(--hairline)",
              }}
            >
              {opt}d
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div
        ref={gridRef}
        className="overflow-x-auto"
        role="grid"
        aria-label="Team activity heatmap"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="inline-grid gap-[3px]" style={{
          gridTemplateColumns: `minmax(100px, max-content) repeat(${dates.length}, 32px)`,
        }}>
          {/* Header row: empty corner + day labels */}
          <div />
          {dates.map((date) => (
            <div
              key={date}
              className="flex items-end justify-center pb-1 text-[10px] leading-none"
              style={{ color: "var(--ink-muted)", height: 24 }}
            >
              {formatDayLabel(date, useDayNames)}
            </div>
          ))}

          {/* Data rows */}
          {members.map((member, rowIdx) => (
            <React.Fragment key={member.id}>
              {/* Member name */}
              <button
                type="button"
                onClick={() => onMemberClick(member.id)}
                className="flex items-center truncate pr-3 text-xs font-medium transition-colors duration-[180ms] hover:underline"
                style={{ color: "var(--ink-soft)", height: 32 }}
                title={member.display_name}
              >
                {member.display_name}
              </button>

              {/* Cells */}
              {dates.map((date, colIdx) => {
                const key = `${member.id}:${date}`;
                const count = cellData.get(key) ?? 0;
                const isSel =
                  selectedCell !== null &&
                  selectedCell[0] === rowIdx &&
                  selectedCell[1] === colIdx;

                return (
                  <div key={key} data-cell={`${rowIdx}-${colIdx}`}>
                    <HeatmapCell
                      count={count}
                      maxCount={maxCount}
                      isEmpty={!memberHasAny.has(member.id)}
                      isSelected={isSel}
                      onClick={() => {
                        setSelectedCell([rowIdx, colIdx]);
                        onCellClick(member.id, date);
                      }}
                      onMouseEnter={() => setHoveredCell([rowIdx, colIdx])}
                      onMouseLeave={() => setHoveredCell(null)}
                    />
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Tooltip for hovered cell */}
      {hoveredCell && (
        <div
          className="text-xs"
          style={{ color: "var(--ink-muted)" }}
          aria-live="polite"
        >
          {members[hoveredCell[0]]?.display_name} &middot;{" "}
          {dates[hoveredCell[1]]} &middot;{" "}
          {cellData.get(`${members[hoveredCell[0]]?.id}:${dates[hoveredCell[1]]}`) ?? 0} items
        </div>
      )}
    </div>
  );
}
