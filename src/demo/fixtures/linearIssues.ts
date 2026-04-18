// Synthetic Linear issues: engineering workflow tracking layer.
// Complements Jira (project management) with engineering-specific tracking
// like tech debt, on-call improvements, and developer tooling.
// Timestamps are relative to "now" (hours_ago).

export interface DemoLinearIssue {
  team_key: string;
  issue_id: string;
  title: string;
  description: string;
  state: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done";
  assignee: string; // seed_id
  hours_ago: number;
  priority: "Urgent" | "High" | "Medium" | "Low";
  labels: string[];
  comments: Array<{
    author: string;
    body: string;
    hours_ago: number;
  }>;
}

export const DEMO_LINEAR_ISSUES: DemoLinearIssue[] = [
  {
    team_key: "ENG",
    issue_id: "ENG-204",
    title: "Quarantine flaky test: auth.session_refresh",
    description:
      "Failing ~3% of CI runs for a week. Quarantining to unblock the team while we investigate root cause.",
    state: "Done",
    assignee: "avery",
    hours_ago: 78,
    priority: "High",
    labels: ["tech-debt", "ci"],
    comments: [
      {
        author: "avery",
        hours_ago: 78,
        body: "Quarantined. Filed ENG-210 for the proper fix. Suspect it's a race condition in the token refresh mock.",
      },
      {
        author: "marcus",
        hours_ago: 76,
        body: "Thank you — this was failing my rate limiter branch every other push.",
      },
    ],
  },
  {
    team_key: "ENG",
    issue_id: "ENG-205",
    title: "Emit p99 latency per service tier",
    description:
      "Part of on-call ergonomics initiative. Per-tier latency metrics let us set per-tier SLOs instead of the current blunt number.",
    state: "Done",
    assignee: "avery",
    hours_ago: 55,
    priority: "Medium",
    labels: ["observability", "on-call"],
    comments: [
      {
        author: "marcus",
        hours_ago: 54,
        body: "This is going to make rotations much calmer. The current single SLO masks tier-specific issues.",
      },
    ],
  },
  {
    team_key: "ENG",
    issue_id: "ENG-206",
    title: "On-call runbook: INC-284 pool exhaustion mitigation",
    description:
      "Capture the mitigation steps so the next person on-call doesn't have to re-derive them under pressure.",
    state: "Done",
    assignee: "rhea",
    hours_ago: 4,
    priority: "High",
    labels: ["on-call", "incident"],
    comments: [
      {
        author: "avery",
        hours_ago: 3.8,
        body: "The 'do not restart the primary first' callout is exactly the thing I'd want at 3am.",
      },
    ],
  },
  {
    team_key: "ENG",
    issue_id: "ENG-208",
    title: "On-call rotation rebalance",
    description:
      "Current rotation is uneven after two people joined. Rebalance so no one has back-to-back weeks. Need OOO calendar updates from everyone.",
    state: "Todo",
    assignee: "avery",
    hours_ago: 96,
    priority: "Medium",
    labels: ["on-call"],
    comments: [
      {
        author: "avery",
        hours_ago: 96,
        body: "Posted a reminder in #eng-general. Will finalize the rotation next week once everyone updates their calendars.",
      },
    ],
  },
  {
    team_key: "ENG",
    issue_id: "ENG-209",
    title: "Kenji onboarding: billing service deep-dive",
    description:
      "Schedule a 1-hour architecture walk-through of the billing service for Kenji. Cover the payments migration, the templating layer, and the Stripe integration.",
    state: "In Progress",
    assignee: "priya",
    hours_ago: 52,
    priority: "Medium",
    labels: ["onboarding"],
    comments: [
      {
        author: "kenji",
        hours_ago: 50,
        body: "The invoice renderer PR was a great first touch. Would love to understand the migration adapter next.",
      },
      {
        author: "priya",
        hours_ago: 48,
        body: "Let's use the Friday demo slot — I'm doing the payments walk-through anyway. Two birds.",
      },
    ],
  },
  {
    team_key: "ENG",
    issue_id: "ENG-210",
    title: "Fix auth.session_refresh flaky test (root cause)",
    description:
      "Root-cause the session_refresh flakiness quarantined in ENG-204. Likely a race condition in the token refresh mock.",
    state: "Backlog",
    assignee: "avery",
    hours_ago: 78,
    priority: "Low",
    labels: ["tech-debt", "ci"],
    comments: [],
  },
];
