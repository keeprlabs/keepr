// Rich evidence card — shows parsed metadata for an evidence item.
// Used in citation popovers and timeline day detail.

import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { EvidenceItem, TeamMember } from "../../lib/types";
import { SourceBadge } from "../../components/primitives/SourceBadge";
import { parseEvidence, type ParsedEvidence } from "./parseEvidence";

interface Props {
  evidence: EvidenceItem;
  members: TeamMember[];
  compact?: boolean;
}

export function EvidenceCard({ evidence, members, compact = false }: Props) {
  const parsed = parseEvidence(evidence.source, evidence.content);
  const actor = evidence.actor_member_id
    ? members.find((m) => m.id === evidence.actor_member_id)
    : null;
  const relativeTime = formatRelative(evidence.timestamp_at);

  return (
    <div
      className={`evidence-card rounded-lg border border-hairline ${
        compact ? "px-3 py-2" : "px-4 py-3"
      }`}
      style={{ maxWidth: 360, backgroundColor: "#fff" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <SourceBadge
          source={evidence.source}
          className={`${compact ? "text-[9px]" : "text-[10px]"} text-ink-faint`}
        />
        <div className="flex items-center gap-2">
          <span
            className={`tabular-nums text-ink-faint ${
              compact ? "text-[9px]" : "text-[10px]"
            }`}
          >
            {relativeTime}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openExternal(evidence.source_url);
            }}
            className="text-[10px] text-ink-muted transition-colors duration-180 hover:text-ink"
          >
            open ↗
          </button>
        </div>
      </div>

      {/* Body — source-specific layout */}
      {!compact && (
        <div className="mt-2">
          <EvidenceBody parsed={parsed} />
        </div>
      )}

      {/* Footer: actor name */}
      {actor && (
        <div
          className={`${compact ? "mt-1" : "mt-2"} text-[10px] text-ink-faint`}
        >
          {actor.display_name}
        </div>
      )}
    </div>
  );
}

function EvidenceBody({ parsed }: { parsed: ParsedEvidence }) {
  switch (parsed.kind) {
    case "github_pr":
      return (
        <div>
          <div className="text-xs font-medium text-ink">
            {parsed.repo}#{parsed.number}
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">{parsed.title}</div>
          {parsed.body && (
            <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-muted">
              {parsed.body}
            </div>
          )}
        </div>
      );
    case "github_review":
      return (
        <div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-soft">{parsed.prRef}</span>
            <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-faint">
              {parsed.state}
            </span>
          </div>
          {parsed.body && (
            <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-muted">
              {parsed.body}
            </div>
          )}
        </div>
      );
    case "gitlab_mr":
      return (
        <div>
          <div className="text-xs font-medium text-ink">
            {parsed.project}!{parsed.iid}
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">{parsed.title}</div>
          {parsed.body && (
            <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-muted">
              {parsed.body}
            </div>
          )}
        </div>
      );
    case "gitlab_review":
      return (
        <div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-soft">{parsed.mrRef}</span>
            <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-faint">
              {parsed.state}
            </span>
          </div>
          {parsed.body && (
            <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-muted">
              {parsed.body}
            </div>
          )}
        </div>
      );
    case "slack_message":
      return (
        <div>
          <div className="text-xs text-ink-muted">
            #{parsed.channel}
            {parsed.isThread && (
              <span className="ml-1 text-ink-faint">(thread)</span>
            )}
          </div>
          <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-soft">
            {parsed.text}
          </div>
        </div>
      );
    case "jira_issue":
      return (
        <div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-ink">{parsed.key}</span>
            <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-faint">
              {parsed.status}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">{parsed.summary}</div>
          {parsed.body && (
            <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-muted">
              {parsed.body}
            </div>
          )}
        </div>
      );
    case "jira_comment":
      return (
        <div>
          <div className="text-xs text-ink-muted">
            {parsed.key} · {parsed.author}
          </div>
          <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-soft">
            {parsed.body}
          </div>
        </div>
      );
    case "linear_issue":
      return (
        <div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-ink">{parsed.identifier}</span>
            <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-faint">
              {parsed.state}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">{parsed.title}</div>
          {parsed.body && (
            <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-muted">
              {parsed.body}
            </div>
          )}
        </div>
      );
    case "linear_comment":
      return (
        <div>
          <div className="text-xs text-ink-muted">
            {parsed.identifier} · {parsed.author}
          </div>
          <div className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-soft">
            {parsed.body}
          </div>
        </div>
      );
    case "fallback":
      return (
        <div className="line-clamp-3 text-[11px] leading-relaxed text-ink-soft">
          {parsed.body}
        </div>
      );
  }
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
