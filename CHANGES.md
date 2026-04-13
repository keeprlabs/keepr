# CHANGES — deviations from the design doc

Recorded while building v1 so the founder can audit what I changed and why.

## Phase 2 — v1.5 features (2026-04-09)

### New data sources: Jira & Linear

- **Jira Cloud integration.** `src/services/jira.ts` implements fetch via
  Jira Cloud REST API v3 with Basic auth (email + API token). Fetches issues,
  comments, and sprint data for selected projects. Normalizes to
  `NormalizedItem[]` and feeds into the shared pipeline. Actor resolution
  matches Jira display names against team member `jira_username` or
  `display_name` fields.
- **Linear integration.** `src/services/linear.ts` implements fetch via
  Linear's GraphQL API with personal API key auth. Fetches issues, comments,
  and project updates for selected teams. Same normalization and actor
  resolution pattern.
- **SQLite migration v3** recreates `integrations`, `sessions`, and
  `evidence_items` tables with expanded CHECK constraints for the new
  provider types (`jira`, `linear`), workflow types (`weekly_update`,
  `perf_evaluation`, `promo_readiness`), and evidence source types
  (`jira_issue`, `jira_comment`, `linear_issue`, `linear_comment`).
  Also adds `jira_username` and `linear_username` columns to `team_members`.
- **Tauri HTTP capabilities** extended for `*.atlassian.net` and
  `api.linear.app`.

### New workflows

- **Weekly engineering update** (`weekly_update`). Same shared pipeline,
  different prompt template at `src/prompts/weekly_eng_update.md`. Sections:
  Shipped / In Progress / Blocked / Upcoming / Highlights. Designed to be
  shareable with stakeholders — professional tone, no internal jargon.
- **Perf evaluation** (`perf_evaluation`). Scaffolded with prompt template
  at `src/prompts/perf_evaluation.md`. Supports optional rubric parsing
  (paste markdown in Settings). Generates evidence-organized evaluation
  with explicit gaps and evidence-gap callouts. 6-month default time range.
  NOTE: prompt tuning is a research problem — the scaffold works but will
  need real-data iteration.
- **Promo readiness** (`promo_readiness`). Builds on perf evaluation pattern
  with gap analysis against target level. Prompt at
  `src/prompts/promo_readiness.md`. Rubric-aware when provided.

### Topics auto-creation

- After each session, the LLM returns a `## Topics` section listing
  recurring themes with cited evidence. The memory layer parses these and
  creates/appends to `topics/{slug}.md` files. The sidebar shows a TOPICS
  section when topic files exist. All prompt templates updated with the
  Topics contract.
- Added `list_md_files` Rust command for directory scanning.
- `readMemoryContext` now includes recent topic files for cross-session
  context.

### UX additions

- **Settings** — new panels for Jira (URL + email + API token + project
  picker), Linear (API key + team picker), and Engineering Rubric (markdown
  textarea).
- **Team members** — expanded to include Jira display name and Linear
  display name fields.
- **Onboarding** — Jira and Linear steps added to the real flow between
  GitHub and Team steps. Both are skippable.
- **Home screen** — weekly engineering update action row added.
- **Command palette** — weekly update, perf evaluation, and promo readiness
  actions added (per-member for perf/promo).
- **Sidebar** — Topics section, expanded workflow labels, jira/linear in
  Connected status dots.

### Things explicitly NOT built in this pass

- Calendar integration (v3)
- Private Slack channels (v3)
- Auto-update (v3)
- Jira/Linear project/team selection in onboarding (only in Settings)
- Dark mode
- Real-data prompt tuning for perf evaluation and promo readiness

## UX

- **Inverted the aesthetic entirely.** The design doc calls for a
  Cursor/Conductor dev-tool dark mode. The founder override moved us to a
  Granola-inspired minimal monochromatic light theme. Everything else in the
  UI section of the doc (sidebar sections, two-region session view,
  command-palette-first nav, keyboard shortcuts, bidirectional citation
  scroll) is preserved; only the visual language changed.
- **Dark mode is v1.5.** Light-only for v1, as the override requests.

## Integrations

- **Dropped `tauri-plugin-oauth`.** It is not published as a Tauri 2
  first-party JS plugin on npm, and the GitHub flow we actually ship is
  Device Authorization (no callback server required). OAuth-callback-based
  flows are not needed for v1.
- **GitHub device flow requires a registered OAuth app Client ID.** There is
  a placeholder `Iv1.keepr-placeholder` in `src/services/github.ts` and a
  `VITE_GITHUB_CLIENT_ID` override. Until the founder registers an OAuth
  app, the PAT path in the onboarding screen is the working default
  (scopes: `repo`, `read:user`). This matches the doc's risk note that
  GitHub may need late-stage setup.
- **Dropped `tauri-plugin-stronghold`.** We use the OS keychain directly
  via the `keyring` crate on the Rust side, exposed through three tauri
  commands (`secret_set`, `secret_get`, `secret_delete`). Simpler, no
  extra JS plugin, same security posture (macOS Keychain).

## Memory layer

- **Implemented the "observed facts only" discipline via a machine-parsed
  `## Memory deltas` section.** Both prompt files instruct Claude to put
  facts — and only facts — in that section, prefixed with `{person_id: tm_N}`.
  The app strips this section from the user-visible session file and uses
  it as the sole input to `people/*.md` appends. This is stricter than
  the doc (which left the parsing mechanism unspecified) and closes the
  "self-poisoning" loophole.
- **`status.md` is split into `## Generated` and `## Manual notes`**, per
  the doc. The manual section is preserved across regenerations by
  re-reading the old file before writing the new one.
- **Conflict detection is best-effort in v1.** If the target file was
  modified externally within the last 30 seconds of our write, we drop
  the new contents to `{path}.pending`. This is a simpler heuristic than
  the full mtime+hash protocol in the doc. A banner surface for resolving
  pending conflicts is deferred to v1.5 — the founder will see a
  `.pending` sibling in Finder if it happens.

## Data pipeline

- **The evidence JSON passed to Haiku includes `url` fields**, but the
  final Sonnet-visible block is composed of per-bucket summaries, not raw
  evidence, so Sonnet never directly sees URLs. Sonnet cites by `ev_N` id
  only. This matches the doc's intent (LLM only sees ids, the app
  resolves ids → urls at render time).
- **Haiku malformed-output fallback.** If every Haiku call fails or
  returns nothing usable, the raw evidence JSON is passed to Sonnet with
  a warning logged to the session's `error_message`. Per the doc.
- **Rate limiting.** Added a 120ms sleep between Slack pagination pages.
  GitHub review fetches are not throttled (per the doc, team pulse for a
  5-10 person team is a few hundred calls and comfortably under 5k/hr).

## Markdown rendering

- **Hand-rolled minimal markdown renderer.** The LLM emits a predictable
  subset (headings, paragraphs, bullets, bold, italic, code, citations),
  and pulling in `marked` / `react-markdown` is ~40KB of dep weight for
  what's ultimately 100 lines of string-walking. Lives in
  `src/lib/markdown.ts`.

## Things I did NOT build (explicit, so you can trust the scope)

- No topic auto-creation (`topics/` directory is not populated by the app)
- No rubric parsing
- No telemetry, no analytics
- No auto-update
- No PII redaction
- No vector search
- No tests beyond the smoke-test path you can hit manually by running
  both workflows
- No signing / notarization pipeline (the debug binary launches; the
  `.dmg` bundling step is the next founder task after registering the
  Apple Developer cert)

## Prompts & evals

- **Rewrote all three prompts to the "zero false claims" bar.**
  `src/prompts/team_pulse.md`, `src/prompts/one_on_one_prep.md`, and
  `src/prompts/haiku_channel_summary.md` now state, explicitly and
  twice, that every blocker / win / incident / morale read / stretched-
  thin bullet MUST cite `[^ev_N]` where `ev_N` is literally present in
  the evidence JSON, and that a shorter honest output beats a longer
  speculative one. Both workflow prompts reject invented citation ids
  up front rather than treating that as a style nit.
- **Observed-facts-only memory discipline is now explicit.** Every
  workflow prompt tells the model: "The memory files below are
  OBSERVED FACTS ONLY. They are not prior interpretations. Any
  interpretation you make in your output is scoped to THIS session
  only and MUST NOT be echoed into Memory deltas." This closes the
  self-poisoning loophole for real.
- **Memory deltas contract is now rigid and documented in-prompt**,
  with good/bad examples inline. The bullet schema is unchanged
  (`- {person_id: tm_N} <observed fact> [^ev_N]`) so the existing
  regex in `src/services/memory.ts#parseDeltas` still parses the
  output without any pipeline edits. The parser and the prompt now
  agree that missing `person_id:` prefix or missing citation = dropped
  fact.
- **Team pulse sections are now exactly:** Blockers, Wins, Incidents,
  People stretched thin, Open questions for the EM, Memory deltas.
  The "stretched thin" section has a hard floor: 2+ independent
  evidence items or skip the section.
- **1:1 prep sections are now exactly:** Wins, Blockers, Questions
  they asked, Coaching moments, Open PRs needing feedback, Memory
  deltas. "Coaching moments" is the only section where session-scoped
  interpretation is allowed — and it's explicitly forbidden from
  bleeding into Memory deltas.
- **Haiku channel summary is tightened** to pure factual prose,
  under 500 tokens, one or two short paragraphs, or the exact string
  `Nothing notable.` — nothing else. The prompt now also forbids
  assigning actors when `actor_id` is null, matching how the pipeline
  resolves unknown authors.
- **First-run empty state is handled in-prompt.** When the memory
  block is the literal string `first run — no prior context` (what
  `pipeline.ts` emits when `readMemoryContext` returns empty), the
  model generates from evidence alone and does not mention the
  absence of memory. It still emits `## Memory deltas` so the run
  seeds the memory files.
- **Added `evals/` — a deliberately minimal prompt eval harness.**
  - `evals/README.md` describes the philosophy (no assertions, no
    golden files, no CI gate — just a founder reading the output).
  - `evals/fixtures/baseline.json`, `stretched_thin.json`, and
    `ambiguous.json` are hand-crafted synthetic weeks for a 5-person
    team. Each has stable `ev_N` ids and a description of what the
    honest output should look like. Baseline is the "quiet week"
    test for padding behavior; stretched-thin tests the 2+ signal
    rule; ambiguous tests the model's restraint on reading morale
    into mixed signals.
  - `evals/run.ts` loads a fixture, runs the real map → reduce shape
    from `pipeline.ts` against it via a plain Node Anthropic provider,
    writes the final markdown plus the per-bucket Haiku summaries to
    `evals/out/` for manual diff review. It deliberately does NOT
    import `src/services/pipeline.ts` because that module pulls in
    Tauri plugins; instead it reads the prompt files directly from
    `src/prompts/` so every prompt edit is immediately reflected. It
    also lints the final output for `[^ev_N]` citations that don't
    exist in the fixture and logs a warning — the only automated
    signal in the harness.
  - `npm run eval -- team_pulse baseline` is the canonical invocation.
    Requires `ANTHROPIC_API_KEY` in env. `tsx` is a new devDependency
    and the only new dep — no runtime deps added.
- **No `src/services/pipeline.ts` changes were needed.** The new
  prompt contract matches the existing parser in `memory.ts` exactly
  (same `{person_id: tm_N}` prefix, same section stripping), so the
  prompt rewrite is contract-compatible with the shipping pipeline.

## Onboarding & demo mode

- **Onboarding is now a router over single-decision pages.** The old
  640px scroll of six mixed concerns was split into one composed
  screen per step under `src/components/onboarding/` — `StepWelcome`,
  `StepLLM`, `StepSlack`, `StepGitHub`, `StepTeam`, `StepMemory`,
  `StepPrivacy`, plus `StepDemoReady` for the demo branch.
  `src/screens/Onboarding.tsx` is now a thin router that picks the
  flow (`real` vs `demo`) and walks the step list. Shared primitives
  (`Title`, `Lede`, `Field`, `Input`, `PrimaryButton`, `GhostButton`,
  `StatusLine`, `StepFooter`) live in
  `src/components/onboarding/primitives.tsx` so every screen inherits
  the same Granola-quiet rhythm.
- **Welcome screen is a single confident decision.** Two paths of
  unequal weight: "Connect Slack & GitHub" (primary, accent-soft card)
  and "Try with sample data" (ghost card). No clutter, no third
  option, no dead ends.
- **LLM step has dignified test-call feedback.** `StatusLine` replaces
  the old raw error string with a calm check / cross icon and a
  friendly translation of the three error shapes that actually come
  back from provider APIs (401 → "double-check you copied it",
  429 → "rate-limited, try again", network → "check your network").
  Changing provider also resets the test state so you never see a
  stale "Verified." next to an unverified key.
- **Slack step has an inline manifest.yml with copy + download.** The
  manifest is rendered in a hairline-bordered code block with a Copy
  button (uses `navigator.clipboard.writeText` — no extra Tauri plugin
  required) and a Download button that saves `keepr-slack-manifest.yml`
  via the existing `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs`.
  The step-by-step is numbered and keyed to Slack's current "From a
  manifest" flow, with a deep link straight to
  `api.slack.com/apps?new_app=1`. Error handling translates
  `invalid_auth`, `not_authed`, and `missing_scope` into plain English
  so the manager never has to search for those codes.
- **GitHub step defaults to PAT.** Per CHANGES.md's earlier entry,
  the Keepr OAuth app isn't registered yet, so device flow would fail
  for most users. The new `StepGitHub` shows PAT as the "Default" tab
  and device flow as "Preferred" — but the device-flow tab is
  visually disabled (opacity-50, non-clickable) until
  `github.GITHUB_CLIENT_ID` stops starting with `Iv1.keepr-placeholder`,
  at which point it lights up automatically with no code change.
- **Team members step fuzzy-matches GitHub handles against Slack
  display names.** As the manager types a display name or a github
  handle, `bestSlackMatch()` in
  `src/components/onboarding/fuzzyMatch.ts` auto-fills the Slack
  column with a visible `auto` badge. Tab accepts the top suggestion.
  A dropdown of the top 4 matches surfaces on focus for manual
  override. Manually-typed slack ids never get stomped by
  auto-matching. The matcher is ~60 lines: exact/substring/token
  overlap/initials — no Levenshtein, no trigram index, no dependency.
- **Memory directory step defaults to `~/Documents/Keepr/` with
  rationale.** The hint text explains why (Time Machine coverage),
  and a "What gets written there" card below names the four file
  patterns (`status.md`, `memory.md`, `sessions/`, `people/`) so the
  manager understands what they're agreeing to before the first run.
- **Privacy consent reflects the design doc's honest tone.** Two
  trust-edge cards state the actual two places data flows (Slack/
  GitHub you already trust; the LLM provider you configured) with no
  marketing varnish. The consent checkbox language is deliberately
  precise: "my Slack & GitHub data is sent to the LLM provider I
  configured when I run a workflow." No weasel words.
- **"Try with sample data" demo mode.** `src/services/demo.ts` is
  the entire implementation:
  - `seedDemoData()` writes the five synthetic team members from
    `src/demo/fixtures/members.ts` into `team_members`, sets
    `memory_dir` to `~/Documents/Keepr-Demo/` (sibling of the real
    default — the user's real notes, if any, are never touched),
    empties the selected-channels / selected-repos lists so the real
    fetchers never run, marks slack + github integrations as active
    with a `{demo: true}` metadata marker, and flips
    `app_config.demo_mode = true`.
  - `runDemoWorkflow()` is a deliberate parallel to
    `pipeline.runWorkflow` — it imports the same three prompt files
    (`?raw` bundling via vite), the same provider interface from
    `services/llm.ts`, and the same `insertEvidence` /
    `writeMemory` calls. The only difference is that the evidence
    comes from `src/demo/fixtures/` instead of
    `fetchRepoActivity` / `fetchChannelHistory`. This means the
    output quality in demo mode is **identical** to the real thing,
    and was achieved without a single edit to `pipeline.ts`.
  - `exitDemoMode()` wipes demo members (identified by their
    `U0DEMO%` slack_user_id prefix), sessions, evidence, slack +
    github integrations, and the demo_mode / onboarded_at /
    privacy_consent_at flags — returning the user to a clean
    pre-onboarding state. The LLM key is deliberately preserved
    because the whole point of "switch to real data" is that the
    user already proved the LLM works for them.
- **Synthetic dataset lives in `src/demo/fixtures/`.** Five engineers
  with distinctive personas (Priya = steady senior, Marcus = stretched
  thin, Avery = invisible reviewer, Kenji = ramping new hire, Rhea =
  incident lead), ~40 Slack messages across three channels
  (eng-general, incidents, proj-payments-migration) with threaded
  replies and cross-references via `<@U0DEMO0NN>` mentions, and 11
  pull requests across two fake repos (acme/billing, acme/platform)
  with review bodies that reveal invisible work (Avery reviewing
  Kenji's first solo PR; Priya unblocking Marcus with one sentence).
  Fixture timestamps are relative ("hours_ago") and resolved at
  runtime so the demo always reads like the week that just happened.
- **App.tsx wiring is minimal and additive.** Five small edits:
  (1) import `isDemoMode`, `runDemoWorkflow`, `exitDemoMode` from
  `services/demo.ts`; (2) load the flag on boot alongside
  `onboarded_at`; (3) `runTeamPulse` and `runOneOnOne` dispatch to
  `runDemoWorkflow` vs `runWorkflow` via a single ternary —
  `pipeline.ts` is not touched; (4) a `FirstRun` empty state takes
  over the Home view when `sessions.length === 0` so the very first
  thing a fresh user sees is "Press ⌘K" with no noise; (5) a
  fixed-position `DemoPill` in the bottom-left corner with a
  click-to-confirm "Switch to real data" exit. The pill is rendered
  in App.tsx rather than in `Titlebar` / `Sidebar` so those
  components stay untouched.
- **First-run empty state** (`src/components/onboarding/FirstRun.tsx`)
  is composed around ⌘K as the central affordance: a breathing
  display-serif headline, a single ghost button that opens the
  palette (the same pattern the Titlebar uses for continuity), and a
  quiet "or run team pulse now →" underline link as the fallback for
  users who aren't keyboard-first yet. The copy swaps between real and
  demo modes so the demo experience never feels like a different app.
- **Flow lengths.** Real flow: Welcome → LLM → Slack → GitHub → Team →
  Memory → Privacy (7 pages, well under 7 minutes on a prepared
  laptop). Demo flow: Welcome → LLM → Demo-ready (3 pages, well under
  2 minutes). Both flows end at the same FirstRun empty state.
- **Known follow-ups / friction.**
  - The demo Slack URLs point at `acme-demo.slack.com` and will
    404 if a user clicks them in the evidence footer. Acceptable for
    v1 (the aesthetic matters more than working links for a demo),
    but a future improvement would be to make the evidence footer
    label those as "sample" so the 404 isn't confusing.
  - `seedDemoData` doesn't populate a pre-written `status.md` /
    `memory.md` in the Keepr-Demo directory, so the first demo run
    hits the "first run — no prior context" branch of the prompt.
    That's fine, but writing a small seeded `memory.md` would let
    the demo showcase memory deltas on the very first run.
  - `exitDemoMode` leaves the `~/Documents/Keepr-Demo/` directory on
    disk. Intentional — the user might want to keep the generated
    briefs as a reference. A "Delete demo files too" option in the
    confirm dialog would be a nice 5-line v1.5 follow-up.
  - The team-members step fuzzy matcher is purely local; it won't
    match "Priya R." against "Priya Raman" across nickname
    normalization (e.g. "Mike" → "Michael"). If/when that becomes a
    real complaint, the right fix is a ~100-line nickname table, not
    a dependency.
  - Demo mode currently can't be entered from Settings after
    onboarding — it's a first-run-only affordance. If a user clicks
    through the real flow and then wants to sanity-check against the
    demo, they'd have to reset the app. An "Enter demo mode" entry
    in Settings would be an obvious v1.1 addition (would require a
    Settings edit, which is out-of-scope for this pass).
