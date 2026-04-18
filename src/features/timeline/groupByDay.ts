// Group evidence items by calendar day within a session's time range.
// Fills empty days so gaps are visible.

import type { EvidenceItem, EvidenceSource } from "../../lib/types";

export interface TimelineDay {
  date: string; // ISO date string: "2026-04-10"
  label: string; // Human-readable: "Apr 10"
  items: EvidenceItem[];
  sourceCounts: Partial<Record<EvidenceSource, number>>;
}

export function groupByDay(
  evidence: EvidenceItem[],
  rangeStart: string,
  rangeEnd: string
): TimelineDay[] {
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);

  // Normalize to day boundaries.
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  // Build a map of date → items.
  const dayMap = new Map<string, EvidenceItem[]>();

  for (const ev of evidence) {
    const d = new Date(ev.timestamp_at);
    const key = d.toISOString().slice(0, 10);
    const list = dayMap.get(key) || [];
    list.push(ev);
    dayMap.set(key, list);
  }

  // Fill in all days in the range.
  const days: TimelineDay[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    const items = dayMap.get(key) || [];

    const sourceCounts: Partial<Record<EvidenceSource, number>> = {};
    for (const item of items) {
      sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
    }

    days.push({
      date: key,
      label: cursor.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      items,
      sourceCounts,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}
