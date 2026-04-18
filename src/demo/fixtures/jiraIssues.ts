// Synthetic Jira issues: project management layer for the same narrative as
// Slack and GitHub fixtures. Timestamps are relative to "now" (hours_ago).

export interface DemoJiraIssue {
  project_key: string;
  issue_key: string;
  summary: string;
  description: string;
  status: "To Do" | "In Progress" | "In Review" | "Done";
  assignee: string; // seed_id
  hours_ago: number;
  comments: Array<{
    author: string;
    body: string;
    hours_ago: number;
  }>;
}

export const DEMO_JIRA_ISSUES: DemoJiraIssue[] = [
  {
    project_key: "PAY",
    issue_key: "PAY-312",
    summary: "Payments migration: ramp to 60% traffic",
    description:
      "Follow-up to PAY-298. After a clean 40% soak, ramp the payments migration to 60%. Blocked until Canada routing fix (PAY-315) lands.",
    status: "In Progress",
    assignee: "priya",
    hours_ago: 8,
    comments: [
      {
        author: "priya",
        hours_ago: 8,
        body: "Canada routing fix merged. Overnight metrics clean. Planning to push 60% tomorrow morning.",
      },
      {
        author: "avery",
        hours_ago: 7,
        body: "EU routing also verified — no issues. Good to go from my side.",
      },
    ],
  },
  {
    project_key: "PAY",
    issue_key: "PAY-315",
    summary: "Fix Canada regional routing on new payments path",
    description:
      "Canada endpoint still resolving to legacy path after the 40% ramp. Discovered during review of PR #3412.",
    status: "Done",
    assignee: "avery",
    hours_ago: 9,
    comments: [
      {
        author: "priya",
        hours_ago: 9,
        body: "Good catch. This was the last blocker for the 60% ramp.",
      },
    ],
  },
  {
    project_key: "PLAT",
    issue_key: "PLAT-445",
    summary: "Rate limiter: switch bucketing key to account_id",
    description:
      "Bucket by account_id instead of api_key for fairer per-customer limits. Includes a migration shim for internal tools with a 2-week sunset.",
    status: "In Review",
    assignee: "marcus",
    hours_ago: 16,
    comments: [
      {
        author: "marcus",
        hours_ago: 44,
        body: "Been stuck on the bucketing decision for a day. Going with account_id per Priya's suggestion in #eng-general.",
      },
      {
        author: "avery",
        hours_ago: 13,
        body: "Left a comment on the PR about missing test coverage for stale api_key + rotated account edge case.",
      },
    ],
  },
  {
    project_key: "PLAT",
    issue_key: "PLAT-446",
    summary: "INC-284 post-mortem: connection pool exhaustion",
    description:
      "Write and circulate post-mortem for INC-284. Root cause: connection pool limits were implicit and shared across primary + replicas. Read-replica failover exhausted the shared pool.",
    status: "In Progress",
    assignee: "rhea",
    hours_ago: 5,
    comments: [
      {
        author: "rhea",
        hours_ago: 5,
        body: "Timeline is complete. Action items section still WIP — want to revisit after the next on-call sync.",
      },
      {
        author: "priya",
        hours_ago: 4,
        body: "Worth noting the failover was triggered by a planned maintenance window. The surprise was the pool config, not the failover itself.",
      },
    ],
  },
  {
    project_key: "PLAT",
    issue_key: "PLAT-447",
    summary: "Connection pool: configurable per-replica limits",
    description:
      "Direct action item from INC-284. Make pool limits explicit and per-role (primary vs replica) instead of the current shared implicit default.",
    status: "In Progress",
    assignee: "rhea",
    hours_ago: 3,
    comments: [],
  },
  {
    project_key: "PAY",
    issue_key: "PAY-318",
    summary: "Invoice renderer: extract currency formatter",
    description:
      "Pull ad-hoc currency formatting out of three call sites into a single helper. Special attention to JPY zero-decimal handling.",
    status: "Done",
    assignee: "kenji",
    hours_ago: 50,
    comments: [
      {
        author: "avery",
        hours_ago: 69,
        body: "Careful with the JPY rounding — we had a bug there last year. Added inline comments on the PR.",
      },
      {
        author: "kenji",
        hours_ago: 48,
        body: "All addressed including the JPY test case. Thanks for the thorough review.",
      },
    ],
  },
  {
    project_key: "PLAT",
    issue_key: "PLAT-448",
    summary: "Stripe webhook retry: exponential backoff with jitter",
    description:
      "Third on-call page this month for webhook backlog. Replace linear retries with exponential backoff + jitter. Add dashboard panel for backlog depth.",
    status: "In Review",
    assignee: "marcus",
    hours_ago: 30,
    comments: [
      {
        author: "rhea",
        hours_ago: 28,
        body: "The dashboard panel is the important half of this. Approved on the PR side.",
      },
    ],
  },
];
