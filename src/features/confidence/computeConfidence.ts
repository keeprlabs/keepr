// Compute per-section confidence from citation density and source diversity.

import type { EvidenceItem } from "../../lib/types";

export interface SectionConfidence {
  sectionTitle: string;
  level: "high" | "medium" | "low";
  citationCount: number;
  uniqueSources: number;
}

const SKIP_SECTIONS = ["memory deltas", "topics"];
const CITE_RE = /\[\^ev_(\d+)\]/g;
const CONFIDENCE_OVERRIDE_RE = /<!--\s*confidence:\s*(high|medium|low)\s*-->/i;
const RECENCY_THRESHOLD_DAYS = 14;

export function computeSectionConfidence(
  markdown: string,
  evidence: EvidenceItem[]
): SectionConfidence[] {
  // Build ev_N → EvidenceItem lookup.
  const evMap = new Map<number, EvidenceItem>();
  evidence.forEach((e, i) => evMap.set(i + 1, e));

  // Split on ## headings.
  const sections: Array<{ title: string; body: string }> = [];
  const lines = markdown.split("\n");
  let currentTitle = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentTitle) {
        sections.push({ title: currentTitle, body: currentBody.join("\n") });
      }
      currentTitle = headingMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  if (currentTitle) {
    sections.push({ title: currentTitle, body: currentBody.join("\n") });
  }

  return sections
    .filter(
      (s) => !SKIP_SECTIONS.some((skip) => s.title.toLowerCase().includes(skip))
    )
    .map((section) => {
      // Check for an explicit confidence override comment.
      const overrideMatch = section.body.match(CONFIDENCE_OVERRIDE_RE);

      // Extract all citation IDs.
      const citedIds = new Set<number>();
      let match: RegExpExecArray | null;
      const re = new RegExp(CITE_RE.source, "g");
      while ((match = re.exec(section.body)) !== null) {
        citedIds.add(parseInt(match[1], 10));
      }

      // Count unique source types.
      const sourceTypes = new Set<string>();
      for (const id of citedIds) {
        const ev = evMap.get(id);
        if (ev) sourceTypes.add(ev.source);
      }

      const citationCount = citedIds.size;
      const uniqueSources = sourceTypes.size;

      let level: SectionConfidence["level"];

      if (overrideMatch) {
        // HTML comment override takes precedence over heuristic.
        level = overrideMatch[1].toLowerCase() as SectionConfidence["level"];
      } else {
        if (citationCount >= 3 && uniqueSources >= 2) {
          level = "high";
        } else if (citationCount >= 2 || uniqueSources >= 2) {
          level = "medium";
        } else {
          level = "low";
        }

        // Recency downgrade: if all cited evidence is older than 14 days, drop one level.
        const now = Date.now();
        const allStale = citedIds.size > 0 && [...citedIds].every((id) => {
          const ev = evMap.get(id);
          if (!ev) return true;
          const age = now - new Date(ev.timestamp_at).getTime();
          return age > RECENCY_THRESHOLD_DAYS * 86_400_000;
        });

        if (allStale && level !== "low") {
          level = level === "high" ? "medium" : "low";
        }
      }

      return {
        sectionTitle: section.title,
        level,
        citationCount,
        uniqueSources,
      };
    });
}
