# CHANGES — deviations from the design doc

Recorded while building v1 so maintainers can audit what I changed and why.


## v0.2.9 — Codex CLI detection fix for nvm/asdf installs (2026-05-01)                                                               
                                                                                                                                       
  Patch on top of v0.2.8. Fixes a hard block for users whose Codex CLI is                                                              
  installed via a Node version manager (nvm, asdf, mise, fnm).                                                                         
                                                                                                                                       
  - `fix(cli)`: Codex installed via nvm/asdf/mise has a `#!/usr/bin/env                                                                
    node` shebang. The previous fix (v0.2.6, commit 08068b3) resolved                                                                  
    Codex's absolute path correctly via the user's login shell, but the                                                                
    spawned `sh -c 'exec /…/codex …'` wrapper inherited the GUI app's                                                                  
    minimal Launch Services PATH — so `env node` failed 127 with "No                                                                   
    such file" and `classifyCliError` mapped that stderr to                                                                            
    `not_installed`. Settings showed "Codex CLI not installed" even                                                                    
    right after `npm install -g @openai/codex`.                                                                                        
    - `resolve_binary` (Rust) now returns `{ path, env_path }`,                                                                        
      capturing the user's `$PATH` from the same login-shell call.                                                                     
      Marker-delimited parsing (`__KEEPR_BIN__=`, `__KEEPR_ENV_PATH__=`)                                                               
      so rc-file noise (oh-my-zsh, direnv, starship) can't corrupt                                                                     
      output.                                                                                                                          
    - `runCliShellWrapped` (TS) prepends `export PATH='<envPath>':"$PATH"`                                                             
      inside the wrapper script before exec — extending, not replacing,                                                                
      so a partial envPath can never strip `/usr/bin`. Inside-script                                                                   
      export over `opts.env` so HOME/USER/TERM/locale are preserved.                                                                   
    - Settings override path (`validate_binary_path`) returns                                                                          
      `envPath:""` — no export emitted, inherited PATH preserved.                                                                      
    - 3 new tests cover env propagation, defensive empty-envPath, and                                                                  
      the override path.                  


## v0.2.8 — Codex onboarding fix (2026-05-01)

Patch on top of v0.2.7. Fixes a hard block for users picking the
Codex CLI provider during onboarding.

- `fix(onboarding)`: the codex CLI was added to the TS `Provider` union
  but the SQLite `integrations` CHECK constraint never gained `'codex'`
  (last widened in migration v8 for GitLab). After a successful codex
  probe, `upsertIntegration("codex", {})` hit a CHECK violation; the
  throw escaped the un-try/catched CLI branch in `StepLLM.test()`,
  leaving `state="testing"` forever, the "Detect & save" button stuck
  on "Detecting…", and Continue gated.
  - Migration v11 rebuilds `integrations` with `'codex'` in the CHECK
    list (same table-rebuild pattern as v8 — SQLite can't `ALTER` a
    CHECK in place).
  - Wrapped the CLI persist step in `try/catch` so any future schema
    mismatch surfaces as a friendly inline error instead of an
    infinite spinner.

## v0.2.7 — ctxd memory layer (2026-05-01)

Bundling [`keeprlabs/ctxd`](https://github.com/keeprlabs/ctxd) v0.3.0 as
Keepr's default memory substrate. Side-by-side with the existing markdown
store (no migration in v0.2.7) — see `tasks/ctxd-integration.md`.

> NOTE: `v0.2.6` on `main` was the auto-updater release (Tauri v2 updater
> plugin). This is a separate, independent milestone. Both ship.

### Post-PR-11 fixes (rolled into the release)

- `fix(ctxd)`: register memory_write/read/query/subjects/related/subscribe
  in `tauri::generate_handler!` (PR 2 defined them but never wired them
  up; every JS-side invoke was failing with Tauri "command not registered"
  and dual-writes silently dropped on the floor). This is the bug that
  kept `ctxd.db` empty after demo runs.
- `fix(ctxd)`: sanitize subject path segments to match ctxd's grammar
  (`[A-Za-z0-9./_-]`). Slack `${channel}:${ts}`, github `${repo}#${n}`,
  gitlab `${proj}!${n}` were rejected by the daemon's `Subject::new`.
  Apply universal `[^A-Za-z0-9._-] → _` mapping in `evidenceSubjectFor`
  and tighten `evidenceSubject`'s validation to mirror ctxd's rules so
  future regressions fail in tests, not at write-time.
- `feat(demo)`: wire `dualWriteEvidenceBatch` into the demo pipeline so
  demo users see populated MemorySearch / Cmd+K results after a pulse
  (session/person/topic events were already covered via `writeMemory`'s
  auto-fired `dualWriteSession`).
- `ci`: fetch the ctxd sidecar before `cargo check` in the CI job —
  Tauri's `build.rs` validates `externalBin` paths and was failing on
  CI because `beforeBuildCommand` only fires for `tauri dev/build`.
- `docs`: refresh README + topology diagram for the v0.2.7 surfaces;
  add Star History chart at the bottom.

### PR 11 — `feat/onboarding-reingest-banner`

- New `src/components/MemoryFirstLaunchBanner.tsx` — quiet header strip
  that appears once per install, the first time both:
    1. `app_config.memory_first_launch_seen` is false, AND
    2. `memory_status` reports daemon ready.
- Body explains the v0.2.7 reality (memory builds forward; v0.4 imports
  the rest), points users at ⌘K and the search screen, and offers a
  "Got it" dismiss button that flips the flag.
- New AppConfig field `memory_first_launch_seen: boolean` (default false).
- App.tsx mounts the banner directly under the Titlebar so the strip
  sits above sidebar + main view without disturbing layout.
- Robust degradation: getConfig failure → no banner, memoryStatus
  failure → no banner, daemon not ready → retry once after 3s then
  give up for the session.
- 6 new vitest tests (338 total): hidden when seen=true, visible when
  seen=false + ready, hidden during starting state, dismiss writes flag
  + unmounts, getConfig failure → silent hide, memoryStatus failure →
  silent hide.

### PR 9 — `feat/activity-sidebar`

- New `src/components/ActivitySidebar.tsx` — collapsible right-edge panel
  with a small `activity ▸` toggle button. Default-collapsed; opens to
  ~320px wide.
- Calls `memory_subscribe('/keepr/**')` on open. Until v0.4 SDK exposes
  the real EventStream, the panel renders a "Coming in v0.4" preview
  with a "What you'll see" event-type list (github, session, person,
  follow-up, topic). Engineer-friendly debug line shows the SDK note.
- Offline / generic-error states render distinct hints; never blocks
  the rest of the UI.
- Wired in App.tsx as a globally-affixed component (z-30, below palette
  and RelatedPanel z-40).
- 8 new vitest tests (332 total): default-collapsed, no subscribe call
  before open, default vs custom pattern, stub-preview render, offline
  hint, generic-error hint, close+reopen flow, header pattern display.

### PR 7 — `feat/person-page-ctxd`

- New `MemoryLayerSection` component appended to `PersonDetail` below
  the existing fact timeline. Calls `memoryRead(personSubject(uuid))`
  for members whose `ctxd_uuid` is populated; renders rows with the
  same row-hover styling as the rest of the screen.
- Lazy `ctxd_uuid`: when null (member hasn't been seen by a session
  run since v0.2.7 deployed), the section renders a "appears after
  next session run" hint instead of an error.
- Each row click opens the RelatedPanel for that subject. Section
  header carries a "related ⇢" affordance for the person itself.
- Offline / error states render quietly without breaking the page.
- App.tsx threads `onOpenSubject` through to `setRelatedSubject`.
- No dedicated test file: composed of well-tested pieces (memoryRead,
  personSubject, isEmptyResult/isTransientError); writing PersonDetail
  mocks would require rebuilding LLM/db/markdown harnesses for marginal
  signal. Integration coverage via RelatedPanel + ctxStore tests.

### PR 4 — `feat/memory-evidence-bridge`

- New `dualWriteEvidenceBatch()` in `src/services/memory.ts` mirrors
  every `evidence_items` insert into a ctxd `evidence.recorded` event
  under the row's `subject_path`. Surfaces real GitHub/Slack/Jira/
  Linear/GitLab content in MemorySearch and the cmd+k palette.
- Wired into `pipeline.ts` immediately after `insertEvidence` returns
  — same fire-and-forget Promise.allSettled pattern as session events.
- Bridge namespace `/keepr/evidence/{source}/...` (not `/work/{source}`)
  per ADR-001, leaving room for a future ctxd-adapter-* binary to
  own the canonical `/work` namespace and a one-time consolidation pass.
- Renamed from "GitHub bridge" to "evidence bridge" in scope —
  evidenceSubjectFor handles all five non-adapter sources, not just
  GitHub.
- 6 new vitest tests (324 total): kill-switch off, empty input,
  null subject_path skip, content_snippet truncation, partial-failure
  tolerance, all-skipped no-warn.

### PR 10 — `feat/pulse-citations`

- `SessionReader` evidence cards gain a `related ⇢` chip next to the
  existing `open ↗` chip when the row has a `subject_path` (populated
  by PR 3's dual-write pipeline). Clicking opens the RelatedPanel from
  PR 8 with that evidence's ctxd subject.
- New `onOpenRelated` prop on `SessionReader`; App.tsx wires it to
  `setRelatedSubject`. Same panel-open path as MemorySearch row clicks.
- Pure rendering change — no prompt edits, no LLM behavior change.
  Older evidence rows (subject_path NULL) get no chip; v0.4 backfill
  will populate them.
- Behavior is covered transitively:
  - `evidenceSubjectFor` mapping → ctxSubjects tests (24).
  - `RelatedPanel` open/empty/error states → RelatedPanel tests (11).
  - The chip itself is a 4-line conditional render; no dedicated test
    to avoid a heavy SessionReader mock-graph rebuild.

### PR 8 — `feat/related-panel`

- New `src/components/RelatedPanel.tsx` — right-edge panel that opens
  when a memory subject is selected (currently from MemorySearch row
  clicks; PR 10 will also wire it to pulse-citation chips).
- Calls `memory_related(subject)`. Groups results by `data.relation`
  field (when ctxd-adapter writes one) or by `event_type` as fallback.
- Empty / not_yet_supported / offline / internal-error states each
  render distinct messaging — never a toast, never a crash.
- Wired in App.tsx as a single `relatedSubject` state; MemorySearch's
  `onOpenSubject` opens the panel; the panel's row click drills into
  another subject without closing.
- 11 new vitest tests (319 total): covers null-subject (renders
  nothing), empty array, not_yet_supported, offline, internal,
  grouping by relation field, fallback grouping by event_type, click
  drilldown, close button, re-fetch on subject change.
- Note: `memory_related` returns `NotYetSupported` against the v0.3.0
  ctxd SDK. The panel renders "Coming soon" until v0.4 SDK lands —
  scaffolding ships now so the upgrade is a single dep bump.

### PR 6 — `feat/memory-search`

- New screen `src/screens/MemorySearch.tsx` — full-results view backed
  by `memory_query`. Filter chips for source (all/keepr/github/slack/
  jira/linear/gitlab), date range (all/7d/30d/90d), and team members.
  Subject-prefix filter chip when launched from the cmd+k palette.
- New `ViewKey` variant `{ kind: "memory_search", q?, subject? }`.
- `App.tsx` wires the cmd+k palette's `onNavigateSubject` to navigate
  into MemorySearch with the subject pre-filled.
- 200ms debounce on the search input. Empty state honestly explains
  the v0.2.7 forward-only reality (older history lands in v0.4 import).
- Offline state surfaces an inline banner ("Memory layer is offline…")
  rather than a toast.
- New `src-tauri/benches/memory_query.rs` — criterion benchmark that
  spawns a real ctxd daemon, pre-loads 1k/10k/50k synthetic events,
  and times `query` with `QueryView::Fts` and `QueryView::Log`. The
  50k case is gated by `KEEPR_BENCH_50K=1` (slow ingest). Tracks the
  kill-criteria p95 < 600ms threshold.
- New `bench-results/README.md` documents how to run.
- 11 new vitest tests covering: empty state, offline banner,
  not_yet_supported→empty, render shape, source filter (keepr-only,
  github bridge), 7d range filter, click→onOpenSubject,
  initialSubject scoping, debounce, person filter chip render.

### PR 5 — `feat/cmdk-palette`

- `CommandPalette` now also queries the ctxd memory layer via
  `memory_query(/keepr, top_k=8)` on a 150ms debounce. Memory hits render
  in a new "In memory layer" section under the existing file-search
  results.
- Memory rows show a subject-derived label (`person`, `session`, `topic`,
  `follow-up`, `status`, `evidence`, or the source name for `/work/**`),
  the event's title (best-effort from `data.summary`/`line`/`name`), and
  the canonical subject path.
- New optional `onNavigateSubject?: (subject: string) => void` prop on
  `CommandPalette`. PR 6 (MemorySearch) wires it; without a handler the
  palette just closes — no crash.
- Transient (offline / timeout) and `not_yet_supported` errors collapse
  to empty results — no toast, no spinner, low-stakes UX.
- 8 new vitest tests covering: skip-when-empty, skip-under-2-chars,
  debounce coalescing, render shape, transient-error path,
  not_yet_supported path, Enter→onNavigateSubject, close-clears-hits.

### PR 3 — `feat/memory-subjects`

- New `src/services/ctxSubjects.ts` — canonical subject path builders for
  every Keepr concept (person, session, topic, follow-up, status, evidence
  bridge), `EVENT_TYPES` vocabulary, `SCHEMA_VERSION = 1`. Public contract;
  see ADR-001.
- New `docs/decisions/001-ctxd-subject-schema.md` — locks the schema.
  UUIDs for person ids (not slugs); `/keepr/**` for Keepr-domain events,
  `/work/**` reserved for adapter-owned namespaces, `/keepr/evidence/**`
  as the bridge until upstream ctxd adapters ship.
- New `db.ts ensureCtxdUuid(memberId)` lazy-populates `team_members.ctxd_uuid`
  on first event-write per person.
- `EvidenceItem.subject_path` populated on insert via `evidenceSubjectFor()`.
  Migration #9 column finally has a writer; PR 10 will read it for
  citation chips.
- `pipeline.ts insertEvidence` now passes `subject_path` for every row.
- `AppConfig.memory_dual_write` (default true) — kill switch; markdown
  remains canonical regardless.
- `memory.ts dualWriteSession()` — fire-and-forget after the markdown
  write loop. Emits `session.completed`, `status.updated` (team_pulse /
  weekly_update only), `person.fact` (per delta line, after lazy uuid
  lookup), `topic.note` (per parsed topic). All under canonical subjects.
  Promise.allSettled tolerates per-event offline failures with one warn
  log.
- 35 new vitest tests: 24 ctxSubjects (golden + validators + helpers),
  11 dualWrite (kill switch, per-workflow events, person/topic emission,
  failure tolerance, schema_version).

### PR 2 — `feat/memory-commands-skeleton`

- Full Tauri command surface: `memory_query`, `memory_read`, `memory_write`,
  `memory_subjects`, `memory_related`, `memory_subscribe`, plus the existing
  `memory_status`. All wrap `ctxd_client::CtxdClient` (git-pinned to
  `keeprlabs/ctxd@v0.3.0`).
- New `src-tauri/src/memory/client.rs` (`ClientCell`) with `Arc<CtxdClient>`
  for cheap, lock-free fan-out to commands. Built once on `Ready` transition
  by `daemon::spawn`; cleared on shutdown.
- New `src-tauri/src/memory/errors.rs` (`MemoryError` tagged-enum) — six
  variants serialized with `kind` discriminator. `From<CtxdError>` classifies
  by substring (offline / timeout / not_found / bad_request / internal).
- `memory_subjects` and `memory_related` return `NotYetSupported` until the
  v0.4 SDK lands those primitives — the v0.3.0 SDK only exposes them via MCP.
  Frontend treats `not_yet_supported` as empty-state, not as error.
- `memory_subscribe` returns an opaque stub; PR 9 (activity sidebar) wires
  the real `EventStream` → Tauri event-emit bridge.
- Frontend wrapper `src/services/ctxStore.ts` adds the six new functions
  plus `isEmptyResult` / `isTransientError` predicates to help UI code
  decide between empty state and error toast.
- New `docs/architecture/ctxd-topology.md` with a Mermaid topology diagram
  and command-surface summary table.
- Tests: 12 new Rust unit tests (`client.rs` × 9, `errors.rs` × 3),
  10 new vitest tests. Total now 20 cargo + 253 vitest.

### PR 1 — `feat/ctxd-bundle`

- Vendor ctxd v0.3.0 prebuilt binary into `src-tauri/binaries/` via
  `scripts/fetch-ctxd.ts` at build time. Binaries are gitignored;
  `CTXD_TARGET=universal-apple-darwin` lipos both arch tarballs for
  release builds. End users never fetch — DMG ships ctxd inside.
- New `src-tauri/src/memory/` module: sidecar lifecycle (`daemon.rs`),
  random per-user TCP ports (`ports.rs`), one Tauri command exposed:
  `memory_status`. See `docs/decisions/002-ctxd-lifecycle.md`.
- Migration #9: `evidence_items.subject_path` for ctxd subject pointers
  (populated forward-only in PR 3).
- Migration #10: `team_members.ctxd_uuid` — UUID-based person IDs in
  ctxd subjects; slugs stay for human-readable URLs.
- New `src/services/ctxStore.ts` thin TS wrapper over `memory_status`.
- Settings → Memory layer panel (status indicator + refresh).

## v0.2.6 — keepr auto updater (2026-04-29)

### keepr auto updater

- Pushes updates to users on older versions

## v0.2.5 — Codex Provider + Team member smart selection  (2026-04-28)

### Codex Provider + Team member smart selection


## v0.2.1 — Claude Code Plugin (2026-04-18)

### CLI surface

Added `keepr cli` subcommands to the desktop binary. The CLI bypasses the Tauri
runtime entirely — reads the same SQLite DB via the system `sqlite3` binary and
writes follow-up files directly to disk. No new Rust dependencies beyond `dirs`.

- `keepr cli status` — config summary (provider, sources, memory dir, last session)
- `keepr cli open [--session N] [--prep <name>]` — launch the GUI
- `keepr cli add-followup "<text>" [--subject <name>]` — create a follow-up file
- `keepr cli pulse` — open the app to run team pulse
- `keepr cli version` — print version
- `keepr cli check-update` — check GitHub Releases for newer version

Invoking `keepr` with no subcommand still launches the GUI as before.

### Claude Code plugin

Plugin lives in `plugin/` with five skills:

- `keepr-setup` — install or update Keepr via Homebrew (gatekeeper for all other skills)
- `keepr-add-followup` — capture a follow-up from conversation context
- `keepr-status` — check config and connection status
- `keepr-open` — launch the desktop app
- `keepr-pulse` — trigger team pulse generation

Each skill checks for `keepr` on PATH first. If missing, invokes the setup
skill which installs via `brew install --cask keeprlabs/tap/keepr`.

Update detection: every skill runs `keepr cli check-update` and mentions
available updates to the user.

### Homebrew cask

- `homebrew/keepr.rb` — cask formula installing Keepr.app + symlink to `/usr/local/bin/keepr`
- Release workflow auto-updates the cask SHA and pushes to `keeprlabs/homebrew-tap`

### Update notifications

- Desktop app: `UpdateBanner` component checks GitHub Releases API on boot (cached 24h), shows dismissable banner with `brew upgrade --cask keepr` instructions
- CLI: `keepr cli check-update` compares local version against latest release
- Plugin: skills run check-update and mention available updates

### NOT modified
- Any v0.2.0 features, prompt templates, or TypeScript UI code
- Memory file format
- Privacy posture (one paragraph added noting plugin shells out locally)

## v0.2.0 — Auditable AI + Daily Loop (2026-04-17)

### Evidence cards (Feature 1)
- Every `[^ev_N]` citation is an interactive token: hover for a rich popover (200ms delay), click to pin
- Source-specific card layouts: GitHub PR (repo, number, title, review state), Slack (channel, thread indicator, message), Jira/Linear (key, status badge, assignee)
- Content parser (`parseEvidence.ts`) extracts typed metadata from the pipeline's normalized content strings — no schema changes needed
- Shared primitives: `Popover` (fixed positioning, focus trap, escape closes, grace period), `SourceBadge` (icon + label), `EvidenceCard` (rich card with compact mode)

### Citation scroll sync (Feature 2)
- Evidence panel slides out from the right edge as an overlay — reading column stays centered at 680px
- Bidirectional highlighting: hover a citation pill → highlight the evidence card, hover a card → highlight citing claims
- CSS classes `.cite-highlighted` and `.ev-highlighted` with accent-colored transitions
- Keyboard: `Alt+1` focuses reading, `Alt+2` focuses evidence panel
- Below 960px falls back to stacked top/bottom layout

### Confidence indicators (Feature 3)
- Per-section badge: green (high), amber (medium), red (low) dots next to `<h2>` headings
- Computed from citation count, source diversity, and recency (>14 days old downgrades one level)
- LLM confidence signal: prompts now emit `<!-- confidence: high|medium|low -->` which overrides heuristic
- Low-confidence sections show banner: "Limited evidence found for this section. Review before acting on it."
- Badges mounted via React portals — no changes to markdown renderer

### Timeline strip (Feature 4)
- Activity sparkline: horizontal scrolling bar, 14 days in view, scroll left for history
- Semantic colors by source type: blue (PRs), purple (reviews), amber (Slack), teal (Jira), indigo (Linear)
- Tick height proportional to evidence count, hover shows breakdown tooltip with source dots
- Click a day → popover with compact EvidenceCards
- Only renders for per-member workflows (1:1 prep, perf eval, promo readiness)

### Follow-up tracker (Feature 5)
- Stored as markdown files in `followups/` with YAML frontmatter (state, subject, origin_session, created_at)
- SQLite `followups` table (migration v7) indexes files for fast queries
- Three-column board: Open | Carried (>7 days) | Resolved (last 14 days)
- Visual urgency: amber >14 days, red >30 days
- Keyboard: j/k navigate, x resolve, c carry, e edit, n new
- Auto-creation from session output via `{follow_up}` tagged bullets
- Accessible via ⌘K "follow-ups" and sidebar Tools section
- 1:1 prep prompt updated with `{follow_up}` tag instruction

### Team heatmap (Feature 6)
- Grid: rows = members, cols = days (7/14/28 configurable)
- Cell color = composite activity intensity, empty cells visually distinct
- Arrow key navigation, hover tooltip with breakdown
- Click cell → side panel with EvidenceCards for that member/day
- Accessible via ⌘K "team heatmap" and sidebar

### Evidence graph (Feature 7)
- Force-directed layout with organic node positioning — nodes repel, edges attract, gravity centers
- Circular nodes with official brand SVG icons (GitHub, Slack, Jira, Linear) inside
- Node radius scales with connection count (more connections = larger node)
- Smooth quadratic bezier curved edges, dashed for "references" relationships
- Interactive: scroll to zoom, drag background to pan, drag individual nodes, click to pin
- Zoom controls: +, -, fit-to-screen buttons. Zoom percentage indicator
- Source type filter pills with colored active states
- Detail card appears on node pin with full evidence metadata
- Accessible via ⌘K "evidence graph" and sidebar

### Demo mode enhancements
- Added Jira fixtures: 7 issues across PAY and PLAT projects with comments
- Added Linear fixtures: 6 issues in ENG team covering tech debt, on-call, onboarding
- Jira and Linear integration markers seeded so sidebar shows them as connected
- All 5 workflow types now supported in demo (was only team_pulse + one_on_one_prep)
- Proper prompt routing and max_tokens for perf_evaluation/promo_readiness
- Clean exit wipes Jira/Linear integrations

### Brand icons
- Official SVG icons for GitHub, Slack, Jira, and Linear used throughout the app
- Centralized in `SourceBadge.tsx`: exported `GitHubIcon`, `SlackIcon`, `JiraIcon`, `LinearIcon` components
- Applied in: evidence graph nodes, settings panel headers, sidebar connected section, evidence cards, citation popovers

### UI polish
- Sidebar sections now collapsible with chevron toggles — People open by default, rest collapsed
- Evidence panel shifts reading column left instead of overlapping (smooth 220ms transition)
- Evidence card and citation popover use solid white background (no translucency)
- Confidence HTML comments (`<!-- confidence: medium -->`) stripped from rendered markdown
- Nested `<button>` in evidence list fixed (outer changed to `div[role=button]`)
- HeatmapGrid: invalid date fallback, missing React Fragment key fixed

### Infrastructure
- Feature flags for all 7 features in Settings → Experimental (all default on)
- Window defaults to 1440×900 (IDE-sized)
- `tabindex="0"` on all citation pills for keyboard accessibility
- Prompt templates updated with confidence signal and follow-up parsing contracts
- Release workflow: added GITHUB_TOKEN to tauri-action for signed DMG builds
- Updated demo GIF covering all new features
- Version bumped to 0.2.0

### NOT modified
- `pipeline.ts` (no structural changes)
- Tauri plugin config (beyond migration v7)
- `PRIVACY.md`
- Memory file format (people/*.md, topics/*.md, status.md unchanged)

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
  Cursor/Conductor dev-tool dark mode. A dev override moved us to a
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
  `VITE_GITHUB_CLIENT_ID` override. Until we register an OAuth
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
  pending conflicts is deferred to v1.5 — the user will see a
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
  `.dmg` bundling step is the next task after registering the
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
    golden files, no CI gate — just a maintainer reading the output).
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
