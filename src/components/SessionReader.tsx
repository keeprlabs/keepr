// The session reader — a "beautifully set document" with bidirectional
// citation scroll. Integrates evidence cards, confidence indicators,
// citation scroll sync (split layout), and timeline strip.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { EvidenceItem, FeatureFlags, SessionRow, TeamMember } from "../lib/types";
import { DEFAULT_FEATURE_FLAGS } from "../lib/types";
import { renderMarkdown } from "../lib/markdown";
import { getConfig } from "../services/db";
import { iconFor, labelFor } from "./primitives/SourceBadge";
import { CitationPopover } from "../features/evidence-cards/CitationPopover";
import { computeSectionConfidence } from "../features/confidence/computeConfidence";
import { ConfidencePortals } from "../features/confidence/ConfidenceBadge";
import { SplitLayout } from "../features/citation-sync/SplitLayout";
import { useClaimHighlight } from "../features/citation-sync/ClaimHighlight";
import { TimelineStrip } from "../features/timeline/TimelineStrip";

// Re-export for backward compat.
export { iconFor, labelFor };

const WORKFLOW_LABELS: Record<string, string> = {
  team_pulse: "Team pulse",
  one_on_one_prep: "1:1 prep",
  weekly_update: "Weekly update",
  perf_evaluation: "Perf evaluation",
  promo_readiness: "Promo readiness",
};

const PER_MEMBER_WORKFLOWS = new Set([
  "one_on_one_prep",
  "perf_evaluation",
  "promo_readiness",
]);

/**
 * Per-member workflows get the target member's name appended to the title
 * ("Perf evaluation — Alice Smith"). Team-wide workflows (team pulse,
 * weekly update) render bare. Matches the format used in the command
 * palette actions.
 */
function buildTitle(session: SessionRow, target: TeamMember | null): string {
  const label = WORKFLOW_LABELS[session.workflow_type] || session.workflow_type;
  return target ? `${label} — ${target.display_name}` : label;
}

interface Props {
  session: SessionRow;
  markdown: string;
  evidence: EvidenceItem[];
  members: TeamMember[];
  onRetry?: (session: SessionRow) => void;
  onDelete?: (id: number) => void;
  /** v0.2.7+: open the right-edge RelatedPanel for this evidence's
   *  ctxd subject. App.tsx wires it to `setRelatedSubject`. Only
   *  surfaces on evidence rows that have a `subject_path` (forward-only,
   *  populated since v0.2.7 PR 3). */
  onOpenRelated?: (subjectPath: string) => void;
}

export function SessionReader({
  session,
  markdown,
  evidence,
  members,
  onRetry,
  onDelete,
  onOpenRelated,
}: Props) {
  const targetMember = useMemo(
    () =>
      session.target_member_id != null
        ? members.find((m) => m.id === session.target_member_id) || null
        : null,
    [session.target_member_id, members]
  );
  const [activeCite, setActiveCite] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FEATURE_FLAGS);
  const readingRef = useRef<HTMLDivElement>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);

  // Load feature flags from config.
  useEffect(() => {
    getConfig().then((cfg) => {
      if (cfg.feature_flags) setFlags(cfg.feature_flags);
    });
  }, []);

  const evById = useMemo(() => {
    const map = new Map<string, EvidenceItem>();
    evidence.forEach((e, i) => map.set(`ev_${i + 1}`, e));
    return map;
  }, [evidence]);

  const rendered = useMemo(
    () => renderMarkdown(markdown, evById),
    [markdown, evById]
  );

  // Confidence computation.
  const confidences = useMemo(() => {
    if (!flags.confidence) return [];
    return computeSectionConfidence(markdown, evidence);
  }, [markdown, evidence, flags.confidence]);

  // Confidence badge portals.
  const { sync: syncConfidence, portals: confidencePortals } = ConfidencePortals({
    confidences,
    containerRef: readingRef,
  });

  // After markdown renders, mount confidence badges.
  useEffect(() => {
    if (flags.confidence && confidences.length > 0) {
      // Small delay to ensure DOM is ready.
      const id = requestAnimationFrame(() => syncConfidence());
      return () => cancelAnimationFrame(id);
    }
  }, [rendered, flags.confidence, confidences, syncConfidence]);

  // Delegate citation clicks.
  useEffect(() => {
    const el = readingRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest(".cite");
      if (!target) return;
      const id = target.getAttribute("data-ev");
      if (!id) return;
      setActiveCite(id);
      const node = evidenceRef.current?.querySelector(`[data-ev-target="${id}"]`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [rendered]);

  // Reflect the active citation onto rendered pills.
  useEffect(() => {
    const el = readingRef.current;
    if (!el) return;
    el.querySelectorAll(".cite.active").forEach((n) => n.classList.remove("active"));
    if (activeCite) {
      el.querySelectorAll(`[data-ev="${activeCite}"]`).forEach((n) =>
        n.classList.add("active")
      );
    }
  }, [activeCite, rendered]);

  // Bidirectional claim <-> evidence highlighting.
  useClaimHighlight(readingRef, evidenceRef, flags.citation_sync);

  const onEvidenceClick = (id: string) => {
    setActiveCite(id);
    const node = readingRef.current?.querySelector(`[data-ev="${id}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const onGoToEvidence = useCallback(
    (id: string) => {
      setActiveCite(id);
      if (!evidenceOpen) setEvidenceOpen(true);
      requestAnimationFrame(() => {
        const node = evidenceRef.current?.querySelector(`[data-ev-target="${id}"]`);
        node?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [evidenceOpen]
  );

  // Export actions — build the export text once, use it for copy + save.
  const buildExport = () => {
    const lines: string[] = [markdown.trim(), ""];
    if (evidence.length) {
      lines.push("---", "", "## Evidence", "");
      evidence.forEach((ev, i) => {
        const n = String(i + 1).padStart(2, "0");
        const when = new Date(ev.timestamp_at).toLocaleString();
        lines.push(`${n}. [${labelFor(ev.source)}, ${when}](${ev.source_url})`);
        lines.push(`    ${ev.content.replace(/\s+/g, " ").trim()}`);
      });
    }
    return lines.join("\n");
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildExport());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API may be unavailable in some Tauri dev contexts.
    }
  };

  const onSave = async () => {
    try {
      const defaultName =
        (session.output_file_path?.split("/").pop() || "session") + "";
      const path = await saveDialog({
        defaultPath: defaultName.endsWith(".md")
          ? defaultName
          : `${defaultName}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeTextFile(path, buildExport());
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[keepr] save failed:", err);
    }
  };

  const onPrint = async () => {
    try {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const { openPath } = await import("@tauri-apps/plugin-opener");
      const dir = await appDataDir();
      const htmlPath = `${dir}/keepr-print.html`;
      const title =
        buildTitle(session, targetMember) +
        " — " +
        fmtRange(session.time_range_start, session.time_range_end);
      const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @import url("https://rsms.me/inter/inter.css");
  @import url("https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap");
  body { font-family: Inter, system-ui, sans-serif; font-size: 15px; line-height: 1.7; color: #0a0a0a; max-width: 680px; margin: 40px auto; padding: 0 24px; }
  h1 { display: none; }
  h2 { font-family: Newsreader, Georgia, serif; font-size: 22px; font-weight: 500; margin: 36px 0 10px; border-top: 1px solid #eee; padding-top: 14px; display: flex; align-items: center; gap: 10px; }
  h3 { font-size: 15px; font-weight: 600; margin: 20px 0 6px; }
  ul { list-style: none; padding-left: 0; }
  ul li { position: relative; padding-left: 22px; margin: 8px 0; }
  ul li::before { content: ""; position: absolute; left: 7px; top: 10px; width: 4px; height: 4px; border-radius: 999px; background: #6b6b68; }
  li { margin: 6px 0; }
  sup { font-size: 9px; color: #888; }
  .meta { font-family: Inter, system-ui, sans-serif; font-size: 14px; color: #444; margin-bottom: 28px; font-weight: 600; }
  .sec-icon { display: inline-flex; width: 18px; height: 18px; flex-shrink: 0; color: #6b6b68; }
  .sec-icon svg { width: 18px; height: 18px; }
  @media print { .no-print { display: none; } }
</style>
</head><body>
<div class="meta">${title}</div>
${rendered}
<script>window.onload = function() { window.print(); }</script>
</body></html>`;
      await writeTextFile(htmlPath, html);
      await openPath(htmlPath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[keepr] print/pdf export failed:", err);
    }
  };

  // Failed-session branch.
  if (session.status === "failed") {
    return (
      <SessionErrorCard
        session={session}
        targetMember={targetMember}
        onRetry={onRetry}
        onDelete={onDelete}
      />
    );
  }

  const showTimeline =
    flags.timeline && PER_MEMBER_WORKFLOWS.has(session.workflow_type);

  // --- Named JSX blocks for split layout ---

  const readingPane = (
    <div className="flex-1 overflow-y-auto px-12 pt-14 pb-10">
      <div className="mx-auto max-w-[680px]">
        {/* Compact metadata header */}
        <div className="no-print mb-10">
          <h1 className="text-[32px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
            {buildTitle(session, targetMember)}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-[14px] text-ink-muted">
            <span>{fmtFriendly(session.time_range_start, session.time_range_end)}</span>
            <span className="text-ink-ghost">·</span>
            <span className="tabular-nums text-[13px]">
              {fmtRange(session.time_range_start, session.time_range_end)}
            </span>
          </div>
          <div className="mt-4 flex items-center gap-1">
            <ActionButton
              onClick={onCopy}
              label={copied ? "Copied" : "Copy"}
            />
            <ActionButton
              onClick={onSave}
              label={saved ? "Saved" : "Save .md"}
            />
            <ActionButton onClick={onPrint} label="Export PDF" />
          </div>
        </div>
      </div>

      {/* Timeline strip — only for per-member workflows */}
      {showTimeline && (
        <div className="mx-auto max-w-[680px] mb-6 hair-b pb-4">
          <TimelineStrip
            evidence={evidence}
            members={members}
            rangeStart={session.time_range_start}
            rangeEnd={session.time_range_end}
            onCiteScroll={onGoToEvidence}
          />
        </div>
      )}

      <div
        ref={readingRef}
        className="reading rise"
        dangerouslySetInnerHTML={{ __html: rendered }}
        data-active-cite={activeCite || ""}
      />

      {/* Confidence badge portals */}
      {flags.confidence && confidencePortals}

      {/* Citation popover */}
      <CitationPopover
        readingRef={readingRef}
        evById={evById}
        members={members}
        enabled={flags.evidence_cards}
        onGoToEvidence={onGoToEvidence}
      />
    </div>
  );

  const evidencePane = (
    <div
      className={`bg-canvas transition-all duration-220 ease-out ${
        flags.citation_sync
          ? "h-full overflow-y-auto px-5 py-5"
          : `hair-t px-12 ${evidenceOpen ? "max-h-[38vh] overflow-y-auto py-7" : "py-3"}`
      }`}
      ref={evidenceRef}
    >
      <div className={flags.citation_sync ? "" : "mx-auto max-w-[680px]"}>
        <button
          onClick={() => setEvidenceOpen((o) => !o)}
          className="group mb-4 flex w-full items-center justify-between py-1 text-left transition-colors duration-180 hover:text-ink"
          aria-expanded={evidenceOpen}
        >
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint group-hover:text-ink">
            <svg
              width="10"
              height="10"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
              className={`transition-transform duration-220 ease-out ${
                evidenceOpen ? "rotate-90" : ""
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
            Evidence
          </div>
          <div className="mono text-[10px] tabular-nums text-ink-ghost">
            {evidence.length}
          </div>
        </button>
        {evidenceOpen && (
          <div className="flex flex-col">
            {evidence.map((ev, i) => {
              const id = `ev_${i + 1}`;
              const active = id === activeCite;
              return (
                <div
                  key={ev.id}
                  role="button"
                  tabIndex={0}
                  data-ev-target={id}
                  onClick={() => onEvidenceClick(id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEvidenceClick(id); } }}
                  className={`group relative flex cursor-pointer items-start gap-4 rounded-md px-2 py-2.5 text-left text-xs transition-colors duration-180 ${
                    active
                      ? "bg-[rgba(10,10,10,0.045)]"
                      : "hover:bg-[rgba(10,10,10,0.025)]"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-ink" />
                  )}
                  <span
                    className={`mono mt-[2px] shrink-0 text-[10px] tabular-nums ${
                      active ? "text-ink" : "text-ink-faint"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`truncate ${
                        active ? "text-ink" : "text-ink-soft"
                      }`}
                    >
                      {ev.content}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                      <span className="flex items-center gap-1 uppercase tracking-[0.08em]">
                        {iconFor(ev.source)}
                        {labelFor(ev.source)}
                      </span>
                      <span className="text-ink-ghost">·</span>
                      <span className="tabular-nums">
                        {new Date(ev.timestamp_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="text-ink-ghost">·</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openExternal(ev.source_url);
                        }}
                        className="text-ink-muted transition-colors duration-180 hover:text-ink"
                      >
                        open ↗
                      </button>
                      {ev.subject_path && onOpenRelated && (
                        <>
                          <span className="text-ink-ghost">·</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenRelated(ev.subject_path!);
                            }}
                            className="text-ink-muted transition-colors duration-180 hover:text-ink"
                            aria-label="Show related memory"
                            title="Show related memory"
                          >
                            related ⇢
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {evidence.length === 0 && (
              <div className="px-2 py-4 text-xs text-ink-faint">
                <span className="block font-medium text-ink-muted">No evidence items for this session.</span>
                <span className="mt-1 block">
                  This usually means the selected channels and repos had no team activity in this time range.
                  Try widening the window or checking your connected sources in Settings.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const statusBar = (
    <div className="hair-t flex items-center justify-between bg-canvas px-8 py-2 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
      <div>
        {WORKFLOW_LABELS[session.workflow_type] || session.workflow_type}
        <span className="mx-2 text-ink-ghost">·</span>
        <span className="tabular-nums normal-case tracking-normal">
          {new Date(session.time_range_start).toLocaleDateString()} →{" "}
          {new Date(session.time_range_end).toLocaleDateString()}
        </span>
      </div>
      {session.output_file_path && (
        <div className="mono truncate normal-case tracking-normal text-ink-ghost">
          {session.output_file_path}
        </div>
      )}
    </div>
  );

  return (
    <SplitLayout
      enabled={flags.citation_sync}
      evidenceOpen={evidenceOpen}
      onToggleEvidence={() => setEvidenceOpen((o) => !o)}
      reading={readingPane}
      evidence={evidencePane}
      statusBar={statusBar}
    />
  );
}

// Notion-style friendly date: "Last week" / "This week" / "Wednesday, Apr 9"
function fmtFriendly(start: string, end: string): string {
  try {
    const e = new Date(end);
    const now = new Date();
    const daysDiff = Math.floor(
      (now.getTime() - e.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysDiff < 1) return "Today";
    if (daysDiff < 2) return "Yesterday";
    if (daysDiff < 7) {
      return e.toLocaleDateString("en-US", { weekday: "long" });
    }
    if (daysDiff < 14) return "Last week";
    return e.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// Compact date range: "Apr 3 – 10, 2026" when same month,
// "Mar 28 – Apr 3, 2026" when different.
function fmtRange(start: string, end: string): string {
  try {
    const s = new Date(start);
    const e = new Date(end);
    const opts: Intl.DateTimeFormatOptions = {
      month: "short",
      day: "numeric",
    };
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
      return `${s.toLocaleDateString("en-US", opts)} – ${e.getDate()}, ${e.getFullYear()}`;
    }
    return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString(
      "en-US",
      opts
    )}, ${e.getFullYear()}`;
  } catch {
    return `${start.slice(0, 10)} → ${end.slice(0, 10)}`;
  }
}

function ActionButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-2.5 py-1 text-[11px] text-ink-muted transition-colors duration-180 ease-out hover:bg-[rgba(10,10,10,0.045)] hover:text-ink"
    >
      {label}
    </button>
  );
}

function SessionErrorCard({
  session,
  targetMember,
  onRetry,
  onDelete,
}: {
  session: SessionRow;
  targetMember: TeamMember | null;
  onRetry?: (session: SessionRow) => void;
  onDelete?: (id: number) => void;
}) {
  const title = buildTitle(session, targetMember);

  return (
    <div className="flex h-full items-center justify-center bg-canvas px-6">
      <div className="max-w-[520px]">
        <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          {title} · failed
        </div>
        <h1 className="display-serif-lg mt-3 text-ink">
          This run didn't finish.
        </h1>
        <div className="mt-3 text-[13px] text-ink-faint">
          {fmtRange(session.time_range_start, session.time_range_end)}
        </div>
        <p className="mt-5 text-sm leading-relaxed text-ink-muted">
          {session.error_message || "No error message was recorded."}
        </p>
        <div className="mt-8 flex items-center gap-3">
          {onRetry && (
            <button
              onClick={() => onRetry(session)}
              className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas transition-all duration-180 ease-calm hover:bg-ink-soft"
            >
              Try again
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(session.id)}
              className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink-soft transition-all duration-180 ease-calm hover:border-ink/20 hover:text-ink"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
