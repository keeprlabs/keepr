// ⌘K command palette. Granola-inspired search sheet: a single input, a
// quiet list of results, and a whisper of a footer. No chrome, no icons
// that don't earn their place.
//
// Beyond commands and team members, the palette also full-text-searches
// across session output files and memory files (status.md, memory.md) so
// you can jump to any prior context with one keystroke.
//
// v0.2.7 PR 5: also queries the ctxd memory layer via `memory_query` so
// the palette surfaces semantic hits across people, sessions, topics,
// and evidence — not just file-level FTS.

import { useEffect, useMemo, useRef, useState } from "react";
import type { TeamMember } from "../lib/types";
import {
  buildSearchCorpus,
  searchCorpus,
  type SearchHit,
} from "../services/search";
import { memoryQuery, isEmptyResult, type EventRow } from "../services/ctxStore";
import { ROOT as MEMORY_ROOT } from "../services/ctxSubjects";

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

interface Props {
  open: boolean;
  onClose: () => void;
  members: TeamMember[];
  actions: CommandAction[];
  onNavigateSession?: (sessionId: number) => void;
  onNavigateMemory?: (file: "status" | "memory") => void;
  /** v0.2.7+: when a memory (ctxd) hit is selected, route by subject.
   *  Caller decides what that means — typically the MemorySearch screen
   *  (PR 6) or a person/session detail. If unset, hitting Enter on a
   *  memory row just closes the palette. */
  onNavigateSubject?: (subject: string) => void;
}

type Row =
  | { kind: "action"; action: CommandAction }
  | { kind: "hit"; hit: SearchHit }
  | { kind: "memory"; event: EventRow };

const MEMORY_DEBOUNCE_MS = 150;
const MEMORY_TOP_K = 8;

export function CommandPalette({
  open,
  onClose,
  members,
  actions,
  onNavigateSession,
  onNavigateMemory,
  onNavigateSubject,
}: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [corpus, setCorpus] = useState<
    Awaited<ReturnType<typeof buildSearchCorpus>>
  >([]);
  const [memoryHits, setMemoryHits] = useState<EventRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
      // Build the corpus lazily each time the palette opens so sessions
      // and memory files are always fresh.
      (async () => {
        try {
          const c = await buildSearchCorpus();
          setCorpus(c);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[keepr] search corpus build failed:", err);
          setCorpus([]);
        }
      })();
    }
  }, [open]);

  // Commands + member 1:1 actions, filtered by the query.
  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base: CommandAction[] = [...actions];

    // Inject per-member 1:1 actions so "1:1 sarah" or just "sarah" works.
    for (const m of members) {
      base.push({
        id: `1on1:${m.id}`,
        label: `1:1 prep — ${m.display_name}`,
        hint: "Run 1:1 prep workflow",
        keywords: `one on one 1:1 prep ${m.display_name}`,
        run: () => actions.find((a) => a.id === "__runOneOnOne")?.run(),
      });
    }

    if (!q) return base.slice(0, 10);
    const scored = base
      .map((a) => {
        const hay = `${a.label} ${a.keywords || ""}`.toLowerCase();
        const idx = hay.indexOf(q);
        let score = -1;
        if (idx >= 0) score = 1000 - idx;
        let j = 0;
        for (const ch of hay) {
          if (ch === q[j]) j++;
          if (j === q.length) break;
        }
        if (j === q.length && score < 0) score = 500;
        return { a, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.a);
    return scored;
  }, [query, actions, members]);

  // Full-text search across sessions + memory files.
  const searchHits = useMemo(
    () => searchCorpus(corpus, query, 6),
    [corpus, query]
  );

  // Debounced ctxd memory query. Daemon-offline / not-yet-supported
  // surface as empty results — never as an error toast (UX rule).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setMemoryHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const hits = await memoryQuery(MEMORY_ROOT, { topK: MEMORY_TOP_K });
        if (!cancelled) setMemoryHits(hits);
      } catch (err) {
        if (cancelled) return;
        if (isEmptyResult(err)) {
          setMemoryHits([]);
          return;
        }
        // Transient (offline / timeout) and internal errors: log + empty.
        // The palette is a low-stakes surface; we don't toast here.
        // eslint-disable-next-line no-console
        console.debug("[keepr] memory_query in palette failed:", err);
        setMemoryHits([]);
      }
    }, MEMORY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, query]);

  // Reset memory hits when the palette closes.
  useEffect(() => {
    if (!open) setMemoryHits([]);
  }, [open]);

  // Combined row list: actions first, then a visual break, then search
  // hits, then memory hits.
  const results = useMemo<Row[]>(() => {
    const rows: Row[] = filteredActions.map((a) => ({
      kind: "action",
      action: a,
    }));
    for (const h of searchHits) {
      rows.push({ kind: "hit", hit: h });
    }
    for (const ev of memoryHits) {
      rows.push({ kind: "memory", event: ev });
    }
    return rows;
  }, [filteredActions, searchHits, memoryHits]);

  useEffect(() => {
    if (cursor >= results.length) setCursor(0);
  }, [results, cursor]);

  const runRow = (row: Row) => {
    if (row.kind === "action") {
      row.action.run();
    } else if (row.kind === "hit") {
      if (row.hit.kind === "session" && row.hit.sessionId !== undefined) {
        onNavigateSession?.(row.hit.sessionId);
      } else if (row.hit.kind === "memory" && row.hit.memoryFile) {
        if (row.hit.memoryFile === "status" || row.hit.memoryFile === "memory") {
          onNavigateMemory?.(row.hit.memoryFile);
        }
      }
    } else if (row.kind === "memory") {
      onNavigateSubject?.(row.event.subject);
    }
  };

  // Keep the active row scrolled into view when arrowing through.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-cursor="${cursor}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink/[0.14] backdrop-blur-[4px] rise" />
      <div
        className="sheet rise relative w-[min(640px,92vw)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <SearchGlyph />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, people, files…"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                const choice = results[cursor];
                if (choice) {
                  onClose();
                  runRow(choice);
                }
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            className="flex-1 bg-transparent text-[17px] font-medium tracking-[-0.005em] text-ink placeholder:text-ink-ghost focus:outline-none"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="text-[10px] uppercase tracking-[0.14em] text-ink-faint hover:text-ink"
              aria-label="Clear"
            >
              clear
            </button>
          )}
        </div>
        <div className="hair-t" />
        <div
          ref={listRef}
          className="max-h-[52vh] overflow-y-auto px-2 py-2"
        >
          {results.length === 0 && (
            <div className="px-4 py-10 text-center">
              <div className="display-serif text-[18px] text-ink-muted">
                Nothing matches.
              </div>
              <div className="mt-1 text-xs text-ink-faint">
                Try "pulse", a teammate's name, or "settings".
              </div>
            </div>
          )}
          {results.map((row, i) => {
            const active = i === cursor;
            const rowKey =
              row.kind === "action"
                ? row.action.id
                : row.kind === "hit"
                ? row.hit.id
                : `mem:${row.event.id}`;
            // Insert section headings before the first row of each kind.
            const prev = i > 0 ? results[i - 1] : null;
            const showFileSection =
              row.kind === "hit" && (!prev || prev.kind === "action");
            const showMemorySection =
              row.kind === "memory" &&
              (!prev || prev.kind === "action" || prev.kind === "hit");
            return (
              <div key={rowKey}>
                {showFileSection && (
                  <div className="mt-3 mb-1 px-3 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    In sessions & memory files
                  </div>
                )}
                {showMemorySection && (
                  <div className="mt-3 mb-1 px-3 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    In memory layer
                  </div>
                )}
                <button
                  data-cursor={i}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => {
                    onClose();
                    runRow(row);
                  }}
                  className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors duration-180 ${
                    active ? "bg-[rgba(10,10,10,0.045)]" : ""
                  }`}
                >
                  {row.kind === "action" && (
                    <>
                      <span
                        className={`mt-[6px] inline-block h-[6px] w-[6px] shrink-0 rounded-full transition-colors duration-180 ${
                          active ? "bg-ink" : "bg-ink-ghost"
                        }`}
                      />
                      <span
                        className={`flex-1 truncate text-sm ${
                          active ? "text-ink" : "text-ink-soft"
                        }`}
                      >
                        {row.action.label}
                      </span>
                      {row.action.hint && (
                        <span className="mono shrink-0 text-[10px] text-ink-faint">
                          {row.action.hint}
                        </span>
                      )}
                    </>
                  )}
                  {row.kind === "hit" && (
                    <>
                      <span
                        className={`mt-[3px] shrink-0 text-[10px] uppercase tracking-[0.12em] ${
                          active ? "text-ink-muted" : "text-ink-faint"
                        }`}
                      >
                        {row.hit.kind === "session" ? "session" : "memory"}
                        {row.hit.archived && (
                          <span className="ml-1 normal-case text-ink-ghost">(archived)</span>
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`truncate text-sm ${
                            active ? "text-ink" : "text-ink-soft"
                          }`}
                        >
                          {row.hit.title}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-ink-faint">
                          {row.hit.snippet}
                        </div>
                      </div>
                    </>
                  )}
                  {row.kind === "memory" && (
                    <>
                      <span
                        className={`mt-[3px] shrink-0 text-[10px] uppercase tracking-[0.12em] ${
                          active ? "text-ink-muted" : "text-ink-faint"
                        }`}
                      >
                        {memoryRowLabel(row.event)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`truncate text-sm ${
                            active ? "text-ink" : "text-ink-soft"
                          }`}
                        >
                          {memoryRowTitle(row.event)}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-ink-faint">
                          {row.event.subject}
                        </div>
                      </div>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="hair-t flex items-center justify-between px-5 py-2.5 text-[10px] text-ink-faint">
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="kbd" aria-label="up arrow">↑</kbd>
              <kbd className="kbd" aria-label="down arrow">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="kbd" aria-label="enter">↵</kbd>
              run
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="kbd" aria-label="escape">esc</kbd>
              close
            </span>
          </div>
          <div className="tracking-[0.14em] uppercase">Keepr</div>
        </div>
      </div>
    </div>
  );
}

// Memory hit visual helpers.
function memoryRowLabel(ev: EventRow): string {
  // Subjects are slash-separated; the second segment is the kind:
  //   /keepr/people/...     → "person"
  //   /keepr/sessions/...   → "session"
  //   /keepr/topics/...     → "topic"
  //   /keepr/followups/...  → "follow-up"
  //   /keepr/status         → "status"
  //   /keepr/evidence/...   → "evidence"
  //   /work/github/...      → "github"
  const parts = ev.subject.split("/").filter(Boolean);
  if (parts[0] === "keepr") {
    if (parts[1] === "people") return "person";
    if (parts[1] === "sessions") return "session";
    if (parts[1] === "topics") return "topic";
    if (parts[1] === "followups") return "follow-up";
    if (parts[1] === "status") return "status";
    if (parts[1] === "evidence") return parts[2] || "evidence";
  }
  if (parts[0] === "work") return parts[1] || "work";
  return parts[0] || "memory";
}

function memoryRowTitle(ev: EventRow): string {
  // Best-effort human-readable title from the event payload.
  const data = ev.data as Record<string, unknown> | null | undefined;
  const candidate =
    (data && (data.summary || data.line || data.name || data.display_name || data.subject_label)) ??
    ev.event_type;
  return String(candidate);
}

function SearchGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0 text-ink-faint"
    >
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M11 11l3 3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
