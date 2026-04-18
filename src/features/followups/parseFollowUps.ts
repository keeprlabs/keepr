// Parse follow-up items from session markdown output.

export interface ParsedFollowUp {
  subject: string;
  description: string;
  memberName: string | null; // extracted from "for X" or section context
  evidenceIds: string[]; // ev_N references found in the text
}

const FOLLOW_UP_SECTIONS = [
  "open questions",
  "follow-ups",
  "action items",
  "open prs needing feedback",
  "open prs",
];

const EV_RE = /\[\^(ev_\d+)\]/g;
const FOLLOW_UP_TAG = /\{follow_up\}/i;

export function parseFollowUps(markdown: string): ParsedFollowUp[] {
  const results: ParsedFollowUp[] = [];
  const lines = markdown.split("\n");
  let inFollowUpSection = false;
  let currentMember: string | null = null;

  for (const line of lines) {
    // Check for section headings
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      const title = h2Match[1].toLowerCase().trim().replace(/[:?.!]+$/, "");
      inFollowUpSection = FOLLOW_UP_SECTIONS.some(s => title.includes(s));
      continue;
    }

    // Check for h3 with member name context
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      currentMember = h3Match[1].trim();
      continue;
    }

    // Parse bullet items
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (!bulletMatch) continue;

    const text = bulletMatch[1];
    const hasTag = FOLLOW_UP_TAG.test(text);

    if (!hasTag && !inFollowUpSection) continue;

    // Extract evidence IDs
    const evidenceIds: string[] = [];
    let evMatch: RegExpExecArray | null;
    const re = new RegExp(EV_RE.source, "g");
    while ((evMatch = re.exec(text)) !== null) {
      evidenceIds.push(evMatch[1]);
    }

    // Clean the text: remove {follow_up} tag and citation refs
    const cleaned = text
      .replace(FOLLOW_UP_TAG, "")
      .replace(/\[\^ev_\d+\]/g, "")
      .trim();

    // Split into subject (first sentence) and description (rest)
    const sentenceEnd = cleaned.search(/[.!?]\s/);
    const subject = sentenceEnd > 0 ? cleaned.slice(0, sentenceEnd + 1).trim() : cleaned;
    const description = sentenceEnd > 0 ? cleaned.slice(sentenceEnd + 1).trim() : "";

    results.push({
      subject,
      description,
      memberName: currentMember,
      evidenceIds,
    });
  }

  return results;
}
