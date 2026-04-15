// ⌘K command palette. Granola-inspired search sheet: a single input, a
// quiet list of results, and a whisper of a footer. No chrome, no icons
// that don't earn their place.
//
// Beyond commands and team members, the palette also full-text-searches
// across session output files and memory files (status.md, memory.md) so
// you can jump to any prior context with one keystroke.

import { useEffect, useMemo, useRef, useState } from "react";
import type { TeamMember } from "../lib/types";
import {
  buildSearchCorpus,
  searchCorpus,
  type SearchHit,
} from "../services/search";

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
}

type Row =
  | { kind: "action"; action: CommandAction }
  | { kind: "hit"; hit: SearchHit };

export function CommandPalette({
  open,
  onClose,
  members,
  actions,
  onNavigateSession,
  onNavigateMemory,
}: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [corpus, setCorpus] = useState<
    Awaited<ReturnType<typeof buildSearchCorpus>>
  >([]);
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

  // Combined row list: actions first, then a visual break, then search
  // hits when the query is ≥2 chars.
  const results = useMemo<Row[]>(() => {
    const rows: Row[] = filteredActions.map((a) => ({
      kind: "action",
      action: a,
    }));
    for (const h of searchHits) {
      rows.push({ kind: "hit", hit: h });
    }
    return rows;
  }, [filteredActions, searchHits]);

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
              row.kind === "action" ? row.action.id : row.hit.id;
            // Insert a section heading before the first search-hit row.
            const prev = i > 0 ? results[i - 1] : null;
            const showSectionBreak =
              row.kind === "hit" && (!prev || prev.kind === "action");
            return (
              <div key={rowKey}>
                {showSectionBreak && (
                  <div className="mt-3 mb-1 px-3 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    In sessions & memory
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
                  {row.kind === "action" ? (
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
                  ) : (
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
