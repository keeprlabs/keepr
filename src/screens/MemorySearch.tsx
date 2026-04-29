// Memory search — full-results screen for the ctxd memory layer.
//
// v0.2.7 PR 6: companion to the cmd+k palette (PR 5). Users land here
// when they want to scan more than 8 hits, slice by source/person/date,
// or pivot from a subject prefix surfaced elsewhere.
//
// Filters compose; queries debounce 200ms. Empty state explains the
// "memory builds as you work" reality of v0.2.7 (forward-only writes).

import { useEffect, useMemo, useState } from "react";
import type { TeamMember } from "../lib/types";
import {
  isEmptyResult,
  isTransientError,
  memoryQuery,
  type EventRow,
} from "../services/ctxStore";
import { ROOT as MEMORY_ROOT } from "../services/ctxSubjects";

interface Props {
  members: TeamMember[];
  /** Optional initial query (e.g. carried over from the palette). */
  initialQuery?: string;
  /** Optional initial subject prefix (e.g. `/keepr/people/{uuid}`). */
  initialSubject?: string;
  /** Open a subject in the right pane (PR 8 will own the panel). */
  onOpenSubject?: (subject: string) => void;
}

type SourceFilter = "all" | "keepr" | "github" | "slack" | "jira" | "linear" | "gitlab";

interface Filters {
  source: SourceFilter;
  /** team_members.id (not ctxd_uuid) — matches data.member_id field on
   *  events written by Keepr's own writers. */
  memberIds: number[];
  /** "7d" | "30d" | "90d" | "all". */
  range: "7d" | "30d" | "90d" | "all";
}

const DEFAULT_FILTERS: Filters = {
  source: "all",
  memberIds: [],
  range: "all",
};

const SEARCH_DEBOUNCE_MS = 200;
const MAX_RESULTS = 50;

export function MemorySearch({
  members,
  initialQuery,
  initialSubject,
  onOpenSubject,
}: Props) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [subjectFilter, setSubjectFilter] = useState(initialSubject ?? MEMORY_ROOT);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [results, setResults] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced fetch.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const hits = await memoryQuery(subjectFilter || MEMORY_ROOT, {
          topK: MAX_RESULTS,
        });
        if (!cancelled) setResults(hits);
      } catch (err) {
        if (cancelled) return;
        if (isEmptyResult(err)) {
          setResults([]);
        } else if (isTransientError(err)) {
          setError("Memory layer is offline. Recent writes will appear once it reconnects.");
          setResults([]);
        } else {
          setError("Search failed. See log for details.");
          setResults([]);
          // eslint-disable-next-line no-console
          console.warn("[keepr] memory_query failed:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, subjectFilter]);

  // Client-side filtering — the v0.2.7 SDK doesn't expose
  // server-side filters yet, so we narrow the returned set here.
  const filtered = useMemo(() => {
    return results.filter((ev) => {
      if (!matchesQuery(ev, query)) return false;
      if (!matchesSource(ev, filters.source)) return false;
      if (!matchesRange(ev, filters.range)) return false;
      if (filters.memberIds.length && !matchesMember(ev, filters.memberIds)) {
        return false;
      }
      return true;
    });
  }, [results, query, filters]);

  return (
    <div className="px-12 py-10 max-w-[920px]">
      <h1 className="display-serif mb-2 text-[28px] tracking-[-0.012em] text-ink">
        Memory search
      </h1>
      <p className="mb-6 text-sm text-ink-faint">
        Search across the ctxd memory layer. Memory builds as you work —
        results from sessions you ran in v0.2.6 and earlier won't appear
        until the v0.4 markdown import lands.
      </p>

      <div className="mb-4">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memory…"
          className="w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-base text-ink placeholder:text-ink-ghost focus:border-ink/40 focus:outline-none transition-colors duration-180"
        />
      </div>

      <FilterRow
        filters={filters}
        members={members}
        subjectFilter={subjectFilter}
        onChange={setFilters}
        onSubjectChange={setSubjectFilter}
      />

      <div className="mt-6">
        {error && (
          <div className="mb-4 rounded-md border border-rose-300/40 bg-rose-50/40 px-4 py-3 text-xs text-rose-900">
            {error}
          </div>
        )}
        {loading && filtered.length === 0 && !error && (
          <div className="px-1 py-4 text-xs text-ink-faint">Searching…</div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <EmptyState query={query} />
        )}
        <div className="divide-y divide-hairline">
          {filtered.map((ev) => (
            <ResultRow
              key={ev.id}
              event={ev}
              members={members}
              onOpen={onOpenSubject}
            />
          ))}
        </div>
        {filtered.length > 0 && filtered.length === MAX_RESULTS && (
          <p className="mt-4 text-[11px] text-ink-faint">
            Showing the first {MAX_RESULTS} results. Refine your search to
            narrow down.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- helpers ------------------------------------------------------

function matchesQuery(ev: EventRow, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  const hay = JSON.stringify(ev.data || {}).toLowerCase();
  return hay.includes(needle) || ev.subject.toLowerCase().includes(needle);
}

function matchesSource(ev: EventRow, source: SourceFilter): boolean {
  if (source === "all") return true;
  if (source === "keepr") return ev.subject.startsWith("/keepr/") && !ev.subject.startsWith("/keepr/evidence/");
  // github / slack / jira / linear / gitlab — match either /work/{source}
  // or /keepr/evidence/{source}/...
  return (
    ev.subject.startsWith(`/work/${source}/`) ||
    ev.subject.startsWith(`/keepr/evidence/${source}/`)
  );
}

function matchesRange(ev: EventRow, range: Filters["range"]): boolean {
  if (range === "all") return true;
  const ts = Date.parse(ev.timestamp);
  if (Number.isNaN(ts)) return true;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return Date.now() - ts <= days * 86_400_000;
}

function matchesMember(ev: EventRow, memberIds: number[]): boolean {
  const data = ev.data as Record<string, unknown> | null | undefined;
  const id = (data && (data.member_id as number | undefined)) ?? null;
  if (id != null && memberIds.includes(id)) return true;
  // Person events embed slug; allow matching by slug too.
  const slug = (data && (data.slug as string | undefined)) ?? null;
  return false || (slug != null && memberIds.length === 0);
}

// ---------- subcomponents -----------------------------------------------

function FilterRow({
  filters,
  members,
  subjectFilter,
  onChange,
  onSubjectChange,
}: {
  filters: Filters;
  members: TeamMember[];
  subjectFilter: string;
  onChange: (next: Filters) => void;
  onSubjectChange: (next: string) => void;
}) {
  const sources: SourceFilter[] = ["all", "keepr", "github", "slack", "jira", "linear", "gitlab"];
  const ranges: Filters["range"][] = ["all", "7d", "30d", "90d"];

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {/* Source chips */}
      <span className="mr-2 uppercase tracking-[0.14em] text-ink-faint">source</span>
      {sources.map((s) => (
        <button
          key={s}
          onClick={() => onChange({ ...filters, source: s })}
          className={chipCls(filters.source === s)}
        >
          {s}
        </button>
      ))}

      <span className="ml-4 mr-2 uppercase tracking-[0.14em] text-ink-faint">range</span>
      {ranges.map((r) => (
        <button
          key={r}
          onClick={() => onChange({ ...filters, range: r })}
          className={chipCls(filters.range === r)}
        >
          {r}
        </button>
      ))}

      {members.length > 0 && (
        <>
          <span className="ml-4 mr-2 uppercase tracking-[0.14em] text-ink-faint">person</span>
          {members.slice(0, 8).map((m) => {
            const active = filters.memberIds.includes(m.id);
            return (
              <button
                key={m.id}
                onClick={() => {
                  const next = active
                    ? filters.memberIds.filter((x) => x !== m.id)
                    : [...filters.memberIds, m.id];
                  onChange({ ...filters, memberIds: next });
                }}
                className={chipCls(active)}
              >
                {m.display_name}
              </button>
            );
          })}
        </>
      )}

      {subjectFilter !== MEMORY_ROOT && (
        <>
          <span className="ml-4 mr-2 uppercase tracking-[0.14em] text-ink-faint">subject</span>
          <button
            onClick={() => onSubjectChange(MEMORY_ROOT)}
            className={chipCls(true)}
            title="Click to clear"
          >
            {subjectFilter} ×
          </button>
        </>
      )}
    </div>
  );
}

function ResultRow({
  event,
  onOpen,
}: {
  event: EventRow;
  members: TeamMember[];
  onOpen?: (subject: string) => void;
}) {
  const label = subjectKindLabel(event.subject);
  const title = bestEffortTitle(event);
  const time = friendlyTime(event.timestamp);

  return (
    <button
      onClick={() => onOpen?.(event.subject)}
      className="flex w-full items-start gap-4 py-3 text-left hover:bg-[rgba(10,10,10,0.025)] transition-colors duration-180"
    >
      <span className="mt-[3px] shrink-0 w-16 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
        {label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink truncate">{title}</div>
        <div className="mt-0.5 text-[11px] text-ink-faint truncate">
          {event.subject}
        </div>
      </div>
      <span className="mono shrink-0 text-[10px] text-ink-faint">{time}</span>
    </button>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="py-12 text-center">
      <div className="display-serif text-[18px] text-ink-muted">
        {query ? "No matches." : "Memory is empty."}
      </div>
      <div className="mt-2 text-xs text-ink-faint max-w-[420px] mx-auto">
        v0.2.7 ships side-by-side with markdown — only sessions you run
        from this version onward populate the memory layer. The v0.4
        bulk import will backfill older history.
      </div>
    </div>
  );
}

function chipCls(active: boolean): string {
  const base =
    "rounded-full border px-2.5 py-0.5 transition-colors duration-180";
  return active
    ? `${base} border-ink bg-ink text-canvas`
    : `${base} border-hairline text-ink-soft hover:text-ink hover:border-ink/40`;
}

function subjectKindLabel(subject: string): string {
  const parts = subject.split("/").filter(Boolean);
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

function bestEffortTitle(ev: EventRow): string {
  const data = ev.data as Record<string, unknown> | null | undefined;
  const candidate =
    (data &&
      (data.summary || data.line || data.name || data.display_name || data.subject_label)) ??
    ev.event_type;
  return String(candidate);
}

function friendlyTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const diffMs = Date.now() - ts;
  const day = 86_400_000;
  if (diffMs < day) return "today";
  if (diffMs < 2 * day) return "yesterday";
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
