// Synthetic GitLab activity — ~12 MRs across two fake projects over a week.
// Shape mirrors src/services/gitlab.ts `FetchedGitLabMR` minus the url
// (loader fabricates https://gitlab.com/acme/... URLs at runtime).

export interface DemoMR {
  project: string; // "acme/platform"
  iid: number;
  title: string;
  body: string;
  author: string; // seed_id
  state: "opened" | "merged" | "closed";
  /** hours ago updated */
  hours_ago: number;
  reviews: Array<{
    author: string;
    state: "APPROVED" | "COMMENTED" | "CHANGES_REQUESTED";
    body: string;
    hours_ago: number;
  }>;
}

export const DEMO_MRS: DemoMR[] = [
  // ---- acme/platform -----------------------------------------------------
  {
    project: "acme/platform",
    iid: 211,
    title: "Nomad: pin deploy controller to v3.4",
    body: "The 3.5 controller is behaving oddly under the new placement constraints — pinning while upstream investigates. Revert is one-liner.",
    author: "priya",
    state: "merged",
    hours_ago: 14,
    reviews: [
      { author: "avery", state: "APPROVED", hours_ago: 13.5, body: "Right call. Captured the upstream ticket link in the runbook too." },
      { author: "marcus", state: "COMMENTED", hours_ago: 13.7, body: "Any risk with the stateful services at 3.4? I'll shadow-check billing on my end just to be safe." },
    ],
  },
  {
    project: "acme/platform",
    iid: 212,
    title: "Rate limiter: refactor bucket key (follow-up to !205)",
    body: "Splitting the platform-wide portion out of the billing-specific change so other services can adopt the same pattern.",
    author: "marcus",
    state: "opened",
    hours_ago: 10,
    reviews: [
      { author: "priya", state: "COMMENTED", hours_ago: 9.2, body: "Structure looks right. I'd extract the bucket-key fn into its own module so it's easy to unit-test." },
    ],
  },
  {
    project: "acme/platform",
    iid: 214,
    title: "SLO dashboards: add error-budget burn panel",
    body: "Adds the 1h/6h/24h burn panels requested after the INC-284 retro. Data source already wired.",
    author: "rhea",
    state: "merged",
    hours_ago: 30,
    reviews: [
      { author: "avery", state: "APPROVED", hours_ago: 29, body: "" },
      { author: "avery", state: "COMMENTED", hours_ago: 29.5, body: "Would be nice to add a short sentence of context at the top of the dashboard so anyone paged knows how to read the burn rate." },
    ],
  },

  // ---- acme/web ----------------------------------------------------------
  {
    project: "acme/web",
    iid: 508,
    title: "Drop IE polyfills from vendor bundle",
    body: "Trims ~34KB gzipped. Browser matrix was updated last quarter; we haven't served IE in production for 6 months.",
    author: "kenji",
    state: "merged",
    hours_ago: 48,
    reviews: [
      { author: "avery", state: "CHANGES_REQUESTED", hours_ago: 70, body: "Good change, but the babel preset list also needs trimming — two inline comments on the exact targets. Otherwise the next dep bump will re-add the polyfills." },
      { author: "avery", state: "APPROVED", hours_ago: 46, body: "All addressed. Ship it." },
    ],
  },
  {
    project: "acme/web",
    iid: 510,
    title: "Invoice page: prevent double-submit on slow networks",
    body: "Repro: hold Wi-Fi off on form submit, tap submit three times, we get three invoices. Adds a submitting flag + disables the button. Also a small a11y fix on the spinner.",
    author: "kenji",
    state: "opened",
    hours_ago: 6,
    reviews: [
      { author: "priya", state: "APPROVED", hours_ago: 4, body: "This is exactly the fix. Linking the original user report in the MR description would help whoever picks this up later." },
    ],
  },
  {
    project: "acme/web",
    iid: 511,
    title: "Settings: loading skeleton for slow dashboards",
    body: "Small polish — rendering the settings page on a cold cache used to show an empty white pane for ~500ms. Now a skeleton.",
    author: "avery",
    state: "merged",
    hours_ago: 20,
    reviews: [
      { author: "rhea", state: "APPROVED", hours_ago: 19, body: "" },
    ],
  },
];
