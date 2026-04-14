// A deliberately minimal markdown renderer. We handle exactly the
// subset the LLM emits: headings, paragraphs, bullets, bold, italic, code,
// and the citation token `[^ev_N]` which becomes a clickable pill.
//
// Keeping this in-house avoids pulling a heavy markdown dep for what's
// ultimately a tiny, well-structured output.

import type { EvidenceItem } from "./types";

// Section icons — monochromatic inline SVG glyphs for the well-known
// sections the two workflow prompts emit. Icons inherit currentColor so
// they match the h2's ink treatment. Keys are lowercased, trimmed, with
// trailing punctuation stripped so minor prompt variations still match.
//
// All icons share a 24x24 viewBox, stroke 1.6, no fill — a coherent
// outline set that sits quietly beside the serif section label.

const SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

const svg = (inner: string) => `<svg ${SVG_ATTRS}>${inner}</svg>`;

const ICON_TROPHY = svg(
  '<path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 4h3v2a3 3 0 0 1-3 3"/><path d="M7 4H4v2a3 3 0 0 0 3 3"/><path d="M12 14v4"/><path d="M8 21h8"/><path d="M10 18h4"/>'
);
const ICON_OCTAGON = svg(
  '<polygon points="8,3 16,3 21,8 21,16 16,21 8,21 3,16 3,8"/><path d="M9 9l6 6M15 9l-6 6"/>'
);
const ICON_ALERT = svg(
  '<path d="M12 3L2 20h20L12 3z"/><path d="M12 10v5"/><circle cx="12" cy="17.5" r=".4" fill="currentColor" stroke="none"/>'
);
const ICON_HOURGLASS = svg(
  '<path d="M6 3h12"/><path d="M6 21h12"/><path d="M6 3v3a6 6 0 0 0 12 0V3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3"/>'
);
const ICON_BUBBLE = svg(
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'
);
const ICON_SPROUT = svg(
  '<path d="M12 20v-8"/><path d="M12 12C12 8 15 5 19 5c0 4-3 7-7 7z"/><path d="M12 12C12 9 9 6 5 6c0 4 3 6 7 6z"/>'
);
const ICON_QUESTION = svg(
  '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7"/><circle cx="12" cy="17" r=".4" fill="currentColor" stroke="none"/>'
);
const ICON_EYE = svg(
  '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.5"/>'
);
const ICON_PACKAGE = svg(
  '<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="0.5"/><path d="M10 12h4"/>'
);
const ICON_REFRESH = svg(
  '<path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/>'
);
const ICON_CALENDAR = svg(
  '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M16 3v4M8 3v4M3 10h18"/>'
);
const ICON_PAPERCLIP = svg(
  '<path d="M21.5 11.5L12 21a6 6 0 0 1-8.5-8.5L13 3a4 4 0 0 1 5.5 5.5L9 18a2 2 0 0 1-3-3l8-8"/>'
);
const ICON_DOCUMENT = svg(
  '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M9 13h6M9 17h4"/>'
);
const ICON_LAYERS = svg(
  '<polygon points="12,2 2,7 12,12 22,7 12,2"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>'
);

const SECTION_ICONS: Record<string, string> = {
  wins: ICON_TROPHY,
  blockers: ICON_OCTAGON,
  incidents: ICON_ALERT,
  "people stretched thin": ICON_HOURGLASS,
  "stretched thin": ICON_HOURGLASS,
  "open questions for the em": ICON_BUBBLE,
  "open questions": ICON_BUBBLE,
  "coaching moments": ICON_SPROUT,
  "questions they asked": ICON_QUESTION,
  "questions asked": ICON_QUESTION,
  "open prs needing feedback": ICON_EYE,
  "open prs": ICON_EYE,
  shipped: ICON_PACKAGE,
  "in progress": ICON_REFRESH,
  upcoming: ICON_CALENDAR,
  evidence: ICON_PAPERCLIP,
  summary: ICON_DOCUMENT,
  memory: ICON_LAYERS,
  "memory deltas": ICON_LAYERS,
};

function iconFor(title: string): string | null {
  const key = title
    .toLowerCase()
    .trim()
    .replace(/[:?.!]+$/, "")
    .trim();
  return SECTION_ICONS[key] || null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string, evById: Map<string, EvidenceItem>): string {
  let out = esc(s);
  // Citations first so their payload survives other replacements.
  out = out.replace(/\[\^(ev_\d+)\]/g, (_m, id: string) => {
    const ev = evById.get(id);
    const n = id.replace("ev_", "");
    if (!ev) return `<sup class="cite dangling">${n}</sup>`;
    const preview = ev.content.slice(0, 160);
    const ellipsis = ev.content.length > 160 ? "\u2026" : "";
    return `<sup class="cite" data-ev="${id}" title="${esc(
      preview + ellipsis
    )}">${n}</sup>`;
  });
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|\s)\*([^*]+)\*/g, "$1<em>$2</em>");
  return out;
}

export function renderMarkdown(
  md: string,
  evById: Map<string, EvidenceItem>
): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] | null = null;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "), evById)}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<ul>${list.join("")}</ul>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("# ")) {
      flushPara();
      flushList();
      out.push(`<h1>${inline(line.slice(2), evById)}</h1>`);
    } else if (line.startsWith("## ")) {
      flushPara();
      flushList();
      const title = line.slice(3);
      const icon = iconFor(title);
      if (icon) {
        out.push(
          `<h2><span class="sec-icon" aria-hidden="true">${icon}</span><span class="sec-label">${inline(
            title,
            evById
          )}</span></h2>`
        );
      } else {
        out.push(`<h2><span class="sec-label">${inline(title, evById)}</span></h2>`);
      }
    } else if (line.startsWith("### ")) {
      flushPara();
      flushList();
      out.push(`<h3>${inline(line.slice(4), evById)}</h3>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      if (!list) list = [];
      list.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""), evById)}</li>`);
    } else if (line.startsWith("---")) {
      flushPara();
      flushList();
      out.push("<hr />");
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out.join("\n");
}

/** Render markdown without the evidence citation system. Used for
 *  query answers and other LLM output that doesn't have ev_N refs. */
export function renderSimpleMarkdown(md: string): string {
  const inlineFmt = (s: string): string => {
    let o = esc(s);
    // [fact_N] → small muted reference
    o = o.replace(/\[fact_(\d+)\]/g, '<sup class="text-[9px] text-ink-faint">[$1]</sup>');
    o = o.replace(/`([^`]+)`/g, "<code>$1</code>");
    o = o.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    o = o.replace(/(^|\s)\*([^*]+)\*/g, "$1<em>$2</em>");
    return o;
  };

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] | null = null;

  const flushP = () => {
    if (para.length) {
      out.push(`<p>${inlineFmt(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushL = () => {
    if (list) {
      out.push(`<ul>${list.join("")}</ul>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushP(); flushL(); continue; }
    const numbered = line.match(/^\d+\.\s+(.+)/);
    const bullet = line.match(/^[-*]\s+(.+)/);
    if (numbered || bullet) {
      flushP();
      if (!list) list = [];
      list.push(`<li>${inlineFmt((numbered || bullet)![1])}</li>`);
    } else {
      flushL();
      para.push(line);
    }
  }
  flushP();
  flushL();
  return out.join("\n");
}
