// Synthetic Slack messages: one week of activity across three channels.
// Timestamps are relative to "now" so the demo always looks fresh; the
// loader computes absolute ISO strings at runtime.
//
// Shape mirrors src/services/slack.ts `FetchedMessage` minus url (the
// loader fabricates a plausible slack archive url from the channel id +
// ts so the evidence footer still has clickable links that 404 in demo
// mode — the aesthetic matters more than functioning links here).

export interface DemoSlackMsg {
  channel_id: string;
  channel_name: string;
  /** hours ago */
  hours_ago: number;
  /** seed_id of DEMO_MEMBERS */
  author: string;
  text: string;
  replies?: Array<{ hours_ago: number; author: string; text: string }>;
}

export const DEMO_SLACK_MESSAGES: DemoSlackMsg[] = [
  // ---- #eng-general ------------------------------------------------------
  {
    channel_id: "C0DEMO001",
    channel_name: "eng-general",
    hours_ago: 6,
    author: "rhea",
    text: "Quick heads up: we hit a cascading timeout in the billing service around 14:10 UTC. Traffic is stable now. I'm leading the post-mortem, draft by EOD Thursday. No customer impact but it was close.",
    replies: [
      { hours_ago: 5.8, author: "priya", text: "Ack. Want me to pair on the timeline? I was in the payments migration when the first alert fired, I have context on what was deploying." },
      { hours_ago: 5.5, author: "rhea", text: "Yes please. Doc link incoming." },
      { hours_ago: 5.2, author: "marcus", text: "I can cover your on-call window tomorrow if you need to focus on the PM." },
    ],
  },
  {
    channel_id: "C0DEMO001",
    channel_name: "eng-general",
    hours_ago: 20,
    author: "priya",
    text: "Payments migration is now at 40% traffic. Error rate flat, p99 down 8ms vs the old path. Bumping to 60% tomorrow morning if the overnight looks clean.",
    replies: [
      { hours_ago: 19.5, author: "avery", text: "Nice. I left a couple of small observability notes on PR #3412 — nothing blocking." },
    ],
  },
  {
    channel_id: "C0DEMO001",
    channel_name: "eng-general",
    hours_ago: 44,
    author: "marcus",
    text: "Rate limiter is blocking on a decision I can't make alone: do we bucket by account_id or by api_key? Account_id is fairer per-customer but api_key is what our internal tools already key off. I've been stuck on this for a day and a half.",
    replies: [
      { hours_ago: 43.5, author: "priya", text: "Bucket by account_id. The fairness story is the one we'll want when we write the customer comms, and api_key bucketing leaks implementation details." },
      { hours_ago: 43, author: "marcus", text: "Ok, going with account_id. Thanks — I needed someone to just say it." },
    ],
  },
  {
    channel_id: "C0DEMO001",
    channel_name: "eng-general",
    hours_ago: 70,
    author: "kenji",
    text: "First solo PR is up (#3418) — small cleanup on the invoice renderer. Would love a careful review, it's my first time touching the templating layer.",
    replies: [
      { hours_ago: 68, author: "avery", text: "On it. I'll leave line comments rather than a dump at the bottom so it's easier to respond to." },
      { hours_ago: 48, author: "kenji", text: "Thanks Avery, all addressed. That was the most useful review I've gotten." },
    ],
  },
  {
    channel_id: "C0DEMO001",
    channel_name: "eng-general",
    hours_ago: 96,
    author: "avery",
    text: "Reminder that the on-call rotation rebalance is happening next week. Please update your OOO in the shared calendar if you have any days off.",
  },

  // ---- #incidents --------------------------------------------------------
  {
    channel_id: "C0DEMO002",
    channel_name: "incidents",
    hours_ago: 7,
    author: "rhea",
    text: "INC-284: billing service 500s. Root cause looks like a connection pool exhaustion after the read-replica failover. Mitigation in progress.",
    replies: [
      { hours_ago: 6.9, author: "rhea", text: "Mitigated. Rolling the pool config change forward." },
      { hours_ago: 6.7, author: "rhea", text: "Resolved. Writing the PM." },
    ],
  },
  {
    channel_id: "C0DEMO002",
    channel_name: "incidents",
    hours_ago: 118,
    author: "marcus",
    text: "Paged overnight for the stripe webhook backlog — cleared itself after 14 minutes. Not filing an incident but logging here for visibility. Third time this month, we should probably look at the retry curve.",
  },

  // ---- #proj-payments-migration ------------------------------------------
  {
    channel_id: "C0DEMO003",
    channel_name: "proj-payments-migration",
    hours_ago: 10,
    author: "priya",
    text: "40% ramp summary: 2.1M requests, 0 spikes in the error budget, client libraries on the new path behaving correctly. Risk list for the 60% ramp is the old EU endpoint — I'd like <@U0DEMO003> to double-check the regional routing before I push.",
    replies: [
      { hours_ago: 9, author: "avery", text: "Looked. EU routing is fine, but I noticed the Canada path is still on the old config. Opening a small PR." },
    ],
  },
  {
    channel_id: "C0DEMO003",
    channel_name: "proj-payments-migration",
    hours_ago: 56,
    author: "priya",
    text: "I'm going to take the weekly demo slot on Friday for the payments migration walk-through. 15 minutes, numbers + one architectural slide. <@U0DEMO004> — would be a good one for you to watch if you want context on what the new path looks like.",
  },
  {
    channel_id: "C0DEMO003",
    channel_name: "proj-payments-migration",
    hours_ago: 80,
    author: "kenji",
    text: "Question from the new-person peanut gallery: why do we use `charge_intent_id` in the migration adapter but `payment_intent_id` everywhere else? Is that a temporary rename or did I miss something?",
    replies: [
      { hours_ago: 79, author: "priya", text: "Great catch — it's a holdover from the pre-2024 naming. The adapter is the last place it lives. Feel free to open a rename PR if you want, it'd be a nice first touch on the core module." },
    ],
  },
];
