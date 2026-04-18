// Infer edges between evidence items via regex pattern matching.
// No ML — just structural relationships derived from source IDs and content.

import type { EvidenceItem } from "../../lib/types";

export interface GraphEdge {
  fromId: number;
  toId: number;
  relationship: string;
}

/**
 * Scan every pair of evidence items and emit edges when content in one
 * references the source_id of another.
 */
export function inferEdges(evidence: EvidenceItem[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  const add = (fromId: number, toId: number, relationship: string) => {
    const key = [Math.min(fromId, toId), Math.max(fromId, toId), relationship].join(":");
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ fromId, toId, relationship });
  };

  // Index evidence by source for fast lookup
  const prItems = evidence.filter((e) => e.source === "github_pr");
  const jiraIssueItems = evidence.filter((e) => e.source === "jira_issue");
  const linearIssueItems = evidence.filter((e) => e.source === "linear_issue");

  // Build lookup maps keyed by source_id
  const prBySourceId = new Map(prItems.map((e) => [e.source_id, e]));
  const jiraBySourceId = new Map(jiraIssueItems.map((e) => [e.source_id, e]));
  const linearBySourceId = new Map(linearIssueItems.map((e) => [e.source_id, e]));

  for (const item of evidence) {
    const content = item.content;

    // Rule 1: github_review mentions a PR source_id → "reviews"
    if (item.source === "github_review") {
      for (const [sourceId, pr] of prBySourceId) {
        if (pr.id === item.id) continue;
        if (content.includes(sourceId)) {
          add(item.id, pr.id, "reviews");
        }
      }
    }

    // Rule 2: slack_message references a GitHub PR URL or #<number> → "discusses"
    if (item.source === "slack_message") {
      // Match GitHub PR URLs: github.com/<owner>/<repo>/pull/<number>
      const prUrlMatches = content.matchAll(
        /github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g,
      );
      for (const m of prUrlMatches) {
        const prNumber = m[1];
        for (const pr of prItems) {
          if (pr.id === item.id) continue;
          // source_id often contains the PR number
          if (pr.source_id === prNumber || pr.source_id.endsWith(`/${prNumber}`)) {
            add(item.id, pr.id, "discusses");
          }
        }
      }

      // Match #123 style references
      const hashMatches = content.matchAll(/#(\d+)/g);
      for (const m of hashMatches) {
        const num = m[1];
        for (const pr of prItems) {
          if (pr.id === item.id) continue;
          if (pr.source_id === num || pr.source_id.endsWith(`/${num}`)) {
            add(item.id, pr.id, "discusses");
          }
        }
      }
    }

    // Rule 3: Any content mentions a Jira key (e.g. KEY-123) → "references"
    const jiraMatches = content.matchAll(/\b([A-Z][A-Z0-9_]+-\d+)\b/g);
    for (const m of jiraMatches) {
      const key = m[1];
      const jira = jiraBySourceId.get(key);
      if (jira && jira.id !== item.id) {
        add(item.id, jira.id, "references");
      }
    }

    // Rule 4: Any content mentions a Linear identifier (e.g. ID-123) → "references"
    const linearMatches = content.matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/g);
    for (const m of linearMatches) {
      const identifier = m[1];
      const linear = linearBySourceId.get(identifier);
      if (linear && linear.id !== item.id) {
        add(item.id, linear.id, "references");
      }
    }
  }

  return edges;
}
