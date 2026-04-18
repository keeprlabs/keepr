// Parse EvidenceItem.content strings into typed metadata.
// Content strings are structured by the pipeline's normalize functions.

import type { EvidenceSource } from "../../lib/types";

// Discriminated union — one variant per source type.

interface GithubPr {
  kind: "github_pr";
  repo: string;
  number: number;
  title: string;
  body: string;
}

interface GithubReview {
  kind: "github_review";
  prRef: string;
  state: string;
  body: string;
}

interface SlackMessage {
  kind: "slack_message";
  channel: string;
  isThread: boolean;
  text: string;
}

interface JiraIssue {
  kind: "jira_issue";
  key: string;
  summary: string;
  status: string;
  body: string;
}

interface JiraComment {
  kind: "jira_comment";
  key: string;
  author: string;
  body: string;
}

interface LinearIssue {
  kind: "linear_issue";
  identifier: string;
  title: string;
  state: string;
  body: string;
}

interface LinearComment {
  kind: "linear_comment";
  identifier: string;
  author: string;
  body: string;
}

interface Fallback {
  kind: "fallback";
  source: EvidenceSource;
  body: string;
}

export type ParsedEvidence =
  | GithubPr
  | GithubReview
  | SlackMessage
  | JiraIssue
  | JiraComment
  | LinearIssue
  | LinearComment
  | Fallback;

export function parseEvidence(
  source: EvidenceSource,
  content: string
): ParsedEvidence {
  try {
    switch (source) {
      case "github_pr": {
        // "PR owner/repo#123: Title\n\nBody"
        const m = content.match(
          /^PR\s+([\w./-]+)#(\d+):\s+(.+?)(?:\n\n([\s\S]*))?$/
        );
        if (m) {
          return {
            kind: "github_pr",
            repo: m[1],
            number: parseInt(m[2], 10),
            title: m[3],
            body: m[4] || "",
          };
        }
        break;
      }
      case "github_review": {
        // "Review on owner/repo#123 (APPROVED): Body"
        const m = content.match(
          /^Review on\s+([\w./-]+#\d+)\s+\((\w+)\):\s+([\s\S]*)$/
        );
        if (m) {
          return {
            kind: "github_review",
            prRef: m[1],
            state: m[2],
            body: m[3],
          };
        }
        break;
      }
      case "slack_message": {
        // "#channel: message text" or "#channel (thread): text"
        const m = content.match(
          /^#([\w-]+)\s*(\(thread\))?\s*:\s+([\s\S]*)$/
        );
        if (m) {
          return {
            kind: "slack_message",
            channel: m[1],
            isThread: !!m[2],
            text: m[3],
          };
        }
        break;
      }
      case "jira_issue": {
        // "KEY-123: Summary [Status]\n\nBody"
        const m = content.match(
          /^([\w]+-\d+):\s+(.+?)\s+\[(.+?)\](?:\n\n([\s\S]*))?$/
        );
        if (m) {
          return {
            kind: "jira_issue",
            key: m[1],
            summary: m[2],
            status: m[3],
            body: m[4] || "",
          };
        }
        break;
      }
      case "jira_comment": {
        // "Comment on KEY-123 by Author: Body"
        const m = content.match(
          /^Comment on\s+([\w]+-\d+)\s+by\s+(.+?):\s+([\s\S]*)$/
        );
        if (m) {
          return {
            kind: "jira_comment",
            key: m[1],
            author: m[2],
            body: m[3],
          };
        }
        break;
      }
      case "linear_issue": {
        // "ID-123: Title [State]\n\nBody"
        const m = content.match(
          /^([\w]+-\d+):\s+(.+?)\s+\[(.+?)\](?:\n\n([\s\S]*))?$/
        );
        if (m) {
          return {
            kind: "linear_issue",
            identifier: m[1],
            title: m[2],
            state: m[3],
            body: m[4] || "",
          };
        }
        break;
      }
      case "linear_comment": {
        // "Comment on ID-123 by Author: Body"
        const m = content.match(
          /^Comment on\s+([\w]+-\d+)\s+by\s+(.+?):\s+([\s\S]*)$/
        );
        if (m) {
          return {
            kind: "linear_comment",
            identifier: m[1],
            author: m[2],
            body: m[3],
          };
        }
        break;
      }
    }
  } catch {
    // Fall through to fallback.
  }

  return { kind: "fallback", source, body: content };
}
