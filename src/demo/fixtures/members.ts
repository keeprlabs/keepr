// Synthetic team for demo mode. Five engineers with plausible, distinctive
// shapes so the generated brief has something to say about each of them.
//
// These ids are NOT the DB ids — they're stable seed keys used inside the
// fixtures. The demo loader creates real team_members rows and maps
// slack_user_id / github_handle through to the pipeline the usual way.

export interface DemoMember {
  seed_id: string;
  display_name: string;
  github_handle: string;
  slack_user_id: string;
  slug: string;
  // Narrative colour — the fixtures are shaped around these so the brief
  // reads like five distinct humans, not five copies of the same person.
  persona: string;
}

export const DEMO_MEMBERS: DemoMember[] = [
  {
    seed_id: "priya",
    display_name: "Priya Raman",
    github_handle: "priyar",
    slack_user_id: "U0DEMO001",
    slug: "priya-raman",
    persona: "steady senior; quietly unblocks the payments migration",
  },
  {
    seed_id: "marcus",
    display_name: "Marcus Chen",
    github_handle: "mchen",
    slack_user_id: "U0DEMO002",
    slug: "marcus-chen",
    persona: "stretched thin; on-call + shipping the rate-limiter",
  },
  {
    seed_id: "avery",
    display_name: "Avery Johansson",
    github_handle: "averyj",
    slack_user_id: "U0DEMO003",
    slug: "avery-johansson",
    persona: "invisible work: reviews everyone's PRs carefully, no big ship",
  },
  {
    seed_id: "kenji",
    display_name: "Kenji Park",
    github_handle: "kpark",
    slack_user_id: "U0DEMO004",
    slug: "kenji-park",
    persona: "newer engineer; ramping on the billing service, first solo PR",
  },
  {
    seed_id: "rhea",
    display_name: "Rhea Okafor",
    github_handle: "rheao",
    slack_user_id: "U0DEMO005",
    slug: "rhea-okafor",
    persona: "incident lead this week; post-mortem in progress",
  },
];
