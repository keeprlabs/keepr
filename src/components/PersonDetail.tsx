// Person detail — query-first timeline view for a team member.
// Shows an ask bar above the accumulated fact timeline, grouped
// by week. Designed to feel like a sibling of SessionReader: same
// reading column (680px), same monochromatic palette, same quiet
// typography hierarchy.
//
// Uses mock data for now. The data layer (facts from DB, LLM query)
// is being built in Lane A on feat/person-timeline. The useState
// hooks here are shaped so the mock arrays swap out for real db
// calls with minimal friction.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PersonFact, QueryHistoryItem, TeamMember } from "../lib/types";

// ---------------------------------------------------------------------------
// Mock data — replace with real db calls when Lane A lands
// ---------------------------------------------------------------------------

const MOCK_FACTS: PersonFact[] = [
  { id: 1, member_id: 1, session_id: 1, fact_type: "shipped", summary: "Shipped auth middleware rewrite (PR #247)", evidence_ids: [12, 15], extracted_at: "2026-04-10T10:00:00Z" },
  { id: 2, member_id: 1, session_id: 1, fact_type: "reviewed", summary: "Reviewed payments migration PR with detailed feedback", evidence_ids: [8], extracted_at: "2026-04-09T14:00:00Z" },
  { id: 3, member_id: 1, session_id: 1, fact_type: "discussed", summary: "Led architecture discussion on caching strategy in #backend", evidence_ids: [22, 23], extracted_at: "2026-04-08T09:00:00Z" },
  { id: 4, member_id: 1, session_id: 2, fact_type: "shipped", summary: "Deployed rate limiter to production", evidence_ids: [31], extracted_at: "2026-04-03T16:00:00Z" },
  { id: 5, member_id: 1, session_id: 2, fact_type: "collaborated", summary: "Paired with Jordan on database indexing optimization", evidence_ids: [35, 36], extracted_at: "2026-04-02T11:00:00Z" },
];

const mockQuery = async (question: string, factCount: number): Promise<string> => {
  void question;
  await new Promise((r) => setTimeout(r, 1500));
  return `Based on ${factCount} accumulated facts: Alex has been actively shipping. In the past two weeks, they shipped the auth middleware rewrite (PR #247) and deployed the rate limiter to production. They also led an architecture discussion on caching strategy and paired with Jordan on database optimization. [fact_1][fact_4]`;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PersonDetailProps {
  member: TeamMember;
  onBack: () => void;
}

export function PersonDetail({ member, onBack }: PersonDetailProps) {
  const [facts] = useState<PersonFact[]>(MOCK_FACTS);
  const [queryText, setQueryText] = useState("");
  const [querying, setQuerying] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState<string | null>(null);
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+K focuses the query bar.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        // Only claim the shortcut when this component is mounted.
        // The global palette toggle in App.tsx fires first; we stop
        // propagation here so both don't fire, but because React
        // synthetic events and native listeners interleave, we rely
        // on the fact that App.tsx checks `paletteOpen` toggle state.
        // A pragmatic trade-off: when PersonDetail is visible, Cmd+K
        // focuses the person query bar instead of opening the palette.
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler, true); // capture phase
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const submitQuery = useCallback(async () => {
    const q = queryText.trim();
    if (!q || querying) return;
    setQuerying(true);
    setCurrentAnswer(null);
    try {
      const answer = await mockQuery(q, facts.length);
      setCurrentAnswer(answer);
      setQueryHistory((prev) => [
        {
          id: Date.now(),
          member_id: member.id,
          query: q,
          answer,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      setQueryText("");
    } finally {
      setQuerying(false);
    }
  }, [queryText, querying, facts.length, member.id]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitQuery();
    }
  };

  // Group facts by week.
  const grouped = useMemo(() => groupByWeek(facts), [facts]);

  // Unique session count.
  const sessionCount = useMemo(
    () => new Set(facts.map((f) => f.session_id)).size,
    [facts],
  );

  const queryEnabled = facts.length > 0;
  const limitedData = facts.length > 0 && facts.length < 10;

  // Empty state.
  if (facts.length === 0) {
    return (
      <div className="flex h-full flex-col bg-canvas">
        <div className="flex-1 overflow-y-auto px-12 pt-14 pb-10">
          <div className="mx-auto max-w-[680px] rise">
            <button
              onClick={onBack}
              className="mb-10 text-xs text-ink-faint transition-colors duration-180 hover:text-ink"
            >
              Back to home
            </button>
            <h1 className="display-serif-lg text-[24px] leading-[1.15] text-ink">
              {member.display_name}
            </h1>
            <p className="mt-6 text-sm leading-relaxed text-ink-muted">
              Run a pipeline session to start building memory for{" "}
              {member.display_name}.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex-1 overflow-y-auto px-12 pt-14 pb-10">
        <div className="mx-auto max-w-[680px] rise">
          {/* Breadcrumb */}
          <button
            onClick={onBack}
            className="mb-10 text-xs text-ink-faint transition-colors duration-180 hover:text-ink"
          >
            Back to home
          </button>

          {/* Name + stats */}
          <h1 className="display-serif-lg text-[24px] leading-[1.15] text-ink">
            {member.display_name}
          </h1>
          <div className="mt-2 text-[13px] tabular-nums text-ink-muted">
            {facts.length} {facts.length === 1 ? "fact" : "facts"}
            <span className="mx-2 text-ink-ghost">·</span>
            {sessionCount} {sessionCount === 1 ? "session" : "sessions"}
          </div>

          {/* Query bar */}
          <div className="mt-8 mb-6">
            <div className="flex items-center gap-2 rounded-md border border-hairline bg-canvas px-3 py-2 transition-colors duration-180 focus-within:border-ink/40">
              <input
                ref={inputRef}
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={!queryEnabled}
                placeholder={`Ask about ${member.display_name}...`}
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-ghost focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                onClick={submitQuery}
                disabled={!queryEnabled || !queryText.trim() || querying}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint transition-colors duration-180 hover:text-ink disabled:opacity-30"
                aria-label="Submit query"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 13V3l10 5-10 5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[10px] text-ink-ghost">
                {queryEnabled ? "" : "No facts yet"}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-ink-ghost">
                <kbd className="kbd">Cmd</kbd>
                <kbd className="kbd">K</kbd>
              </span>
            </div>
          </div>

          {/* Query answer */}
          {querying && (
            <div className="mb-6 rounded-md border border-hairline px-4 py-4">
              <div className="text-sm text-ink-faint breathing">
                Thinking...
              </div>
            </div>
          )}
          {!querying && currentAnswer && (
            <div className="mb-6 rounded-md border border-hairline px-4 py-4 rise">
              <p className="text-sm leading-relaxed text-ink-soft">
                {limitedData && (
                  <span className="text-ink-faint">
                    Based on limited data ({facts.length} facts):{" "}
                  </span>
                )}
                {currentAnswer}
              </p>
            </div>
          )}

          {/* Past queries */}
          {queryHistory.length > 0 && (
            <div className="mb-8">
              <button
                onClick={() => setHistoryOpen((o) => !o)}
                className="group mb-3 flex w-full items-center gap-2 py-1 text-left"
                aria-expanded={historyOpen}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden
                  className={`text-ink-faint transition-transform duration-220 ease-out ${
                    historyOpen ? "rotate-90" : ""
                  }`}
                >
                  <path
                    d="M4 2.5l4 3.5-4 3.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint group-hover:text-ink">
                  Past queries
                </span>
                <span className="mono text-[10px] tabular-nums text-ink-ghost">
                  {queryHistory.length}
                </span>
              </button>
              {historyOpen && (
                <div className="flex flex-col gap-3 pl-[18px]">
                  {queryHistory.map((item) => (
                    <div key={item.id} className="rise">
                      <div className="text-xs font-medium text-ink-muted">
                        {item.query}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-ink-faint">
                        {item.answer}
                      </div>
                      <div className="mt-1 text-[10px] tabular-nums text-ink-ghost">
                        {fmtShort(item.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Fact timeline grouped by week */}
          <div className="flex flex-col">
            {grouped.map(({ label, facts: weekFacts }) => (
              <div key={label}>
                {/* Week separator */}
                <div className="hair-b mb-4 mt-6 pb-2 flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                    {label}
                  </span>
                </div>
                {/* Fact rows */}
                <div className="flex flex-col gap-1">
                  {weekFacts.map((fact) => (
                    <div
                      key={fact.id}
                      className="row-hover flex items-start gap-3 rounded-md px-2 py-2"
                    >
                      <FactTypeBadge type={fact.fact_type} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink-soft">
                          {fact.summary}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                          <span className="tabular-nums">
                            {fmtDay(fact.extracted_at)}
                          </span>
                          <span className="text-ink-ghost">·</span>
                          <span className="tabular-nums">
                            {fact.evidence_ids.length}{" "}
                            {fact.evidence_ids.length === 1
                              ? "source"
                              : "sources"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FactTypeBadge({ type }: { type: PersonFact["fact_type"] }) {
  return (
    <span className="mt-[3px] shrink-0 rounded-full border border-hairline px-2 py-[1px] text-[10px] uppercase tracking-[0.08em] text-ink-faint">
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}

// Group facts by ISO week, labeling the current week "This week",
// the previous week "Last week", and older weeks by date range.
function groupByWeek(
  facts: PersonFact[],
): Array<{ label: string; facts: PersonFact[] }> {
  if (facts.length === 0) return [];

  const now = new Date();
  const startOfWeek = (d: Date): Date => {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    const s = new Date(d);
    s.setDate(diff);
    s.setHours(0, 0, 0, 0);
    return s;
  };

  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const buckets = new Map<string, PersonFact[]>();
  const sorted = [...facts].sort(
    (a, b) =>
      new Date(b.extracted_at).getTime() - new Date(a.extracted_at).getTime(),
  );

  for (const fact of sorted) {
    const d = new Date(fact.extracted_at);
    const weekStart = startOfWeek(d);
    let label: string;
    if (weekStart.getTime() >= thisWeekStart.getTime()) {
      label = "This week";
    } else if (weekStart.getTime() >= lastWeekStart.getTime()) {
      label = "Last week";
    } else {
      const end = new Date(weekStart);
      end.setDate(end.getDate() + 6);
      label = `${fmtDay(weekStart.toISOString())} – ${fmtDay(end.toISOString())}`;
    }
    const bucket = buckets.get(label) || [];
    bucket.push(fact);
    buckets.set(label, bucket);
  }

  return Array.from(buckets.entries()).map(([label, facts]) => ({
    label,
    facts,
  }));
}
