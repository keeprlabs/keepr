// Synthetic GitHub activity — ~20 PRs across two fake repos over a week.
// Shape mirrors src/services/github.ts `FetchedPR` minus the url (loader
// fabricates https://github.com/acme/... URLs at runtime).

export interface DemoPR {
  repo: string; // "acme/billing"
  number: number;
  title: string;
  body: string;
  author: string; // seed_id
  state: "open" | "merged";
  /** hours ago updated */
  hours_ago: number;
  reviews: Array<{
    author: string;
    state: "APPROVED" | "COMMENTED" | "CHANGES_REQUESTED";
    body: string;
    hours_ago: number;
  }>;
}

export const DEMO_PRS: DemoPR[] = [
  // ---- acme/billing ------------------------------------------------------
  {
    repo: "acme/billing",
    number: 3412,
    title: "Payments migration: promote to 40% traffic",
    body: "Flips the traffic split for the payments migration from 20% to 40%. Metrics dashboard linked in the migration doc; overnight soak was clean. Next ramp is 60% Thursday morning.",
    author: "priya",
    state: "merged",
    hours_ago: 22,
    reviews: [
      { author: "avery", state: "COMMENTED", hours_ago: 22.5, body: "Two small suggestions on the observability counters — non-blocking. The rollout logic looks right. Double-checked the Canada routing, see PR #3415." },
      { author: "marcus", state: "APPROVED", hours_ago: 22.2, body: "lgtm, nice gradual ramp" },
    ],
  },
  {
    repo: "acme/billing",
    number: 3413,
    title: "Rate limiter: switch bucketing key to account_id",
    body: "Per discussion in #eng-general, bucketing by account_id gives us the fairness story we want in customer comms. Includes a migration shim for the internal tools that still key by api_key — it will 410 in two weeks.",
    author: "marcus",
    state: "open",
    hours_ago: 16,
    reviews: [
      { author: "priya", state: "APPROVED", hours_ago: 14, body: "Shim looks right. I'd pull the 410 timeline into the PR description so it's captured in the audit log. Otherwise ship it." },
      { author: "avery", state: "COMMENTED", hours_ago: 13, body: "The test for the shim only covers the happy path — can you add a case for a stale api_key hitting a rotated account? I hit exactly that during the last on-call." },
    ],
  },
  {
    repo: "acme/billing",
    number: 3415,
    title: "Payments migration: fix Canada regional routing",
    body: "Small follow-up to #3412 — the Canada path was still resolving to the legacy endpoint. This was caught during the 40% ramp review.",
    author: "avery",
    state: "merged",
    hours_ago: 9,
    reviews: [
      { author: "priya", state: "APPROVED", hours_ago: 8.8, body: "Exactly right. Thanks for catching this before the 60% push." },
    ],
  },
  {
    repo: "acme/billing",
    number: 3418,
    title: "Invoice renderer: extract currency formatter",
    body: "Pulling the ad-hoc currency formatting out of three call sites into a single helper. First solo PR; the templating layer is new to me so I'd appreciate a careful review.",
    author: "kenji",
    state: "merged",
    hours_ago: 50,
    reviews: [
      { author: "avery", state: "CHANGES_REQUESTED", hours_ago: 69, body: "This is a good direction. Four inline comments — the biggest one is around the JPY zero-decimal handling, we had a bug there last year so I want to make sure we don't reintroduce it. Happy to pair on the rounding logic if helpful." },
      { author: "avery", state: "APPROVED", hours_ago: 48, body: "All addressed. The JPY test case is exactly what I wanted. Ship it." },
    ],
  },
  {
    repo: "acme/billing",
    number: 3419,
    title: "Post-mortem doc for INC-284 (pool exhaustion)",
    body: "Draft post-mortem for INC-284. Timeline is complete; action items section still WIP. Please leave comments rather than approving — I want to revisit the action items after the next on-call sync.",
    author: "rhea",
    state: "open",
    hours_ago: 5,
    reviews: [
      { author: "priya", state: "COMMENTED", hours_ago: 4.5, body: "Timeline is accurate. One thing worth adding: the read-replica failover was triggered by a maintenance window we had telegraphed — the surprise was the pool config, not the failover itself. That reframes the learning." },
    ],
  },
  {
    repo: "acme/billing",
    number: 3420,
    title: "Stripe webhook retry curve: exponential backoff",
    body: "Third page this month for the webhook backlog. Moving from linear retries to exponential backoff with jitter. Includes a dashboard panel for backlog depth so we stop getting surprised by this at 3am.",
    author: "marcus",
    state: "open",
    hours_ago: 30,
    reviews: [
      { author: "rhea", state: "APPROVED", hours_ago: 28, body: "The dashboard panel is the important half of this PR. Approved." },
    ],
  },
  {
    repo: "acme/billing",
    number: 3421,
    title: "Rename charge_intent_id → payment_intent_id in adapter",
    body: "Caught by Kenji in the migration channel — the last place the old name lived. Mechanical rename, no behaviour change.",
    author: "kenji",
    state: "merged",
    hours_ago: 42,
    reviews: [
      { author: "priya", state: "APPROVED", hours_ago: 41, body: "Clean rename. Nice first touch on the core module." },
    ],
  },

  // ---- acme/platform -----------------------------------------------------
  {
    repo: "acme/platform",
    number: 1188,
    title: "Connection pool: configurable per-replica limits",
    body: "Direct action item from INC-284. Pool limits were implicit and shared across primary + replicas. This makes them explicit per-role.",
    author: "rhea",
    state: "open",
    hours_ago: 3,
    reviews: [],
  },
  {
    repo: "acme/platform",
    number: 1185,
    title: "Metrics: emit p99 latency per service tier",
    body: "Part of the on-call ergonomics work. Gives us tier-level latency so we can set per-tier SLOs instead of the current one-size number.",
    author: "avery",
    state: "merged",
    hours_ago: 55,
    reviews: [
      { author: "marcus", state: "APPROVED", hours_ago: 54, body: "This is going to make rotations a lot calmer. Thank you." },
    ],
  },
  {
    repo: "acme/platform",
    number: 1186,
    title: "Flaky test quarantine: auth.session_refresh",
    body: "Quarantining a flaky test that has been failing ~3% of CI runs for a week. Ticket filed to fix properly.",
    author: "avery",
    state: "merged",
    hours_ago: 78,
    reviews: [
      { author: "priya", state: "APPROVED", hours_ago: 77, body: "" },
    ],
  },
  {
    repo: "acme/platform",
    number: 1187,
    title: "On-call runbook: INC-284 mitigation steps",
    body: "Captures the pool exhaustion mitigation as a runbook entry so the next person doesn't have to re-derive it under pressure.",
    author: "rhea",
    state: "merged",
    hours_ago: 4,
    reviews: [
      { author: "avery", state: "APPROVED", hours_ago: 3.8, body: "The phrasing around 'do not restart the primary first' is exactly the thing I'd want to see at 3am. Good." },
    ],
  },
];
