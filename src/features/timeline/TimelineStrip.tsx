// Activity sparkline — horizontal scrolling bar, 14 days in view.
// Each day gets a fixed-width column with a vertical tick.
// Scroll left to go back in time. Starts scrolled to the end (most recent).

import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceItem, TeamMember } from "../../lib/types";
import { Popover } from "../../components/primitives/Popover";
import { groupByDay, type TimelineDay } from "./groupByDay";
import { TimelineDayDetail } from "./TimelineDayDetail";

// Semantic colors for evidence types — subtle but distinguishable.
const SOURCE_COLORS: Record<string, string> = {
  github_pr: "#2563eb",     // blue — PRs opened/merged
  github_review: "#7c3aed", // purple — reviews
  slack_message: "#d97706",  // amber — Slack messages
  jira_issue: "#0891b2",    // teal — Jira issues
  jira_comment: "#0891b2",
  linear_issue: "#6366f1",  // indigo — Linear issues
  linear_comment: "#6366f1",
};

function sourceColor(source: string): string {
  return SOURCE_COLORS[source] || "var(--ink-muted)";
}

function dominantColor(day: TimelineDay): string {
  let best = "";
  let max = 0;
  for (const [source, count] of Object.entries(day.sourceCounts)) {
    if ((count ?? 0) > max) {
      max = count ?? 0;
      best = source;
    }
  }
  return sourceColor(best);
}

interface Props {
  evidence: EvidenceItem[];
  members: TeamMember[];
  rangeStart: string;
  rangeEnd: string;
  onCiteScroll?: (evId: string) => void;
}

const MAX_TICK_HEIGHT = 36;
const BAR_HEIGHT = 52;
const DAYS_IN_VIEW = 14;

export function TimelineStrip({
  evidence,
  members,
  rangeStart,
  rangeEnd,
  onCiteScroll,
}: Props) {
  const days = groupByDay(evidence, rangeStart, rangeEnd);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedDay, setSelectedDay] = useState<TimelineDay | null>(null);
  const [selectedRect, setSelectedRect] = useState<DOMRect | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const maxItems = Math.max(1, ...days.map((d) => d.items.length));

  // Scroll to end (most recent) on mount.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days.length]);

  const handleClick = useCallback(
    (day: TimelineDay, el: HTMLElement) => {
      if (day.items.length === 0) return;
      setSelectedDay((prev) => (prev?.date === day.date ? null : day));
      setSelectedRect(el.getBoundingClientRect());
    },
    []
  );

  // Each day column width = container / 14.
  // We use CSS calc so it adapts to the container width.
  const dayWidth = `calc(100% / ${DAYS_IN_VIEW})`;

  return (
    <div className="relative">
      {/* Scrollable sparkline */}
      <div
        ref={scrollRef}
        className="overflow-x-auto"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(10,10,10,0.12) transparent",
        }}
      >
        <div
          className="flex items-end"
          style={{
            width: days.length <= DAYS_IN_VIEW
              ? "100%"
              : `calc(${days.length} * (100% / ${DAYS_IN_VIEW}))`,
            minWidth: "100%",
            height: BAR_HEIGHT + 20, // ticks + label
          }}
        >
          {days.map((day, i) => {
            const count = day.items.length;
            const tickH = count > 0
              ? Math.max(4, Math.round((count / maxItems) * MAX_TICK_HEIGHT))
              : 0;
            const isHovered = hoveredIndex === i;
            const isSelected = selectedDay?.date === day.date;

            return (
              <button
                key={day.date}
                onClick={(e) => handleClick(day, e.currentTarget)}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="relative flex flex-col items-center"
                style={{
                  width: days.length <= DAYS_IN_VIEW ? dayWidth : `calc(100% / ${days.length})`,
                  flexShrink: 0,
                  height: BAR_HEIGHT + 20,
                  cursor: count > 0 ? "pointer" : "default",
                }}
                aria-label={`${day.label}: ${count} item${count !== 1 ? "s" : ""}`}
              >
                {/* Tick area */}
                <div
                  className="flex items-end justify-center flex-1"
                  style={{ width: "100%", paddingBottom: 1 }}
                >
                  {count > 0 && (
                    <span
                      style={{
                        width: "50%",
                        maxWidth: 14,
                        minWidth: 3,
                        height: tickH,
                        borderRadius: 2,
                        background: dominantColor(day),
                        opacity: isHovered || isSelected ? 1 : 0.55,
                        transition: "opacity 150ms, height 150ms",
                        display: "block",
                      }}
                    />
                  )}
                </div>

                {/* Baseline sits here via the border below */}

                {/* Day label */}
                <span
                  className={`text-[10px] tabular-nums whitespace-nowrap mt-1.5 transition-colors duration-150 ${
                    isHovered || isSelected ? "text-ink-soft" : "text-ink-ghost"
                  } ${count > 0 ? "font-medium" : ""}`}
                >
                  {day.label}
                </span>

                {/* Hover count badge with source breakdown */}
                {isHovered && count > 0 && (
                  <span
                    className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[9px] font-medium text-canvas flex items-center gap-1"
                    style={{ zIndex: 10, pointerEvents: "none" }}
                  >
                    {day.label} · {count}
                    {Object.entries(day.sourceCounts).map(([src, n]) => (
                      <span
                        key={src}
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: "50%",
                          background: sourceColor(src),
                          display: "inline-block",
                          opacity: 0.8,
                        }}
                        title={`${src}: ${n}`}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Baseline rule — inside the scroll container so it spans full width */}
        <div
          style={{
            position: "sticky",
            left: 0,
            right: 0,
            height: 0,
            borderTop: "1px solid var(--hairline)",
            marginTop: -(20 + 2), // pull up above labels
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Day detail popover on click */}
      {selectedDay && selectedDay.items.length > 0 && (
        <Popover
          open={true}
          onClose={() => setSelectedDay(null)}
          anchorRect={selectedRect}
          placement="bottom"
        >
          <TimelineDayDetail
            day={selectedDay}
            members={members}
            onCardClick={(evId) => {
              onCiteScroll?.(evId);
              setSelectedDay(null);
            }}
          />
        </Popover>
      )}
    </div>
  );
}
