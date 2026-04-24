# Plan: Inline scope selection in onboarding

## Problem

Today's onboarding (`src/screens/Onboarding.tsx`) walks the user through:
`welcome → llm → slack → github → jira → linear → team → rubric → memory → privacy`

Each integration step (`StepSlack`, `StepGitHub`, `StepJira`, `StepLinear`) does
**authentication only**: paste token, call `auth.test`, save secret + integration row,
advance. There is no step where the user selects WHICH channels / repos / projects
to actually pull from.

The pipeline (`src/services/pipeline.ts:509-517`) requires
`cfg.selected_slack_channels` / `cfg.selected_github_repos` /
`cfg.selected_jira_projects` / `cfg.selected_linear_teams` to be non-empty:

```ts
const hasAnySources = cfg.selected_github_repos.length > 0
  || cfg.selected_slack_channels.length > 0
  || (cfg.selected_jira_projects || []).length > 0
  || (cfg.selected_linear_teams || []).length > 0;
if (!hasAnySources) {
  throw new Error("No data sources selected. Go to Settings ...");
}
```

So a user who finishes onboarding and clicks "Run first pulse now" on
`FirstRun.tsx:44-49` gets a thrown error and is told to navigate to Settings,
where (`Settings.tsx:281-367`) they must:
1. Click "Load public channels" (Slack)
2. Toggle each channel chip individually
3. Click "Load my repos" (GitHub)
4. Toggle each repo chip individually
5. Repeat for Jira projects, Linear teams
6. Navigate back to Home and re-trigger pulse

This breaks trust at the most important moment: the very first pulse.

## Fix direction (chosen)

**Inline scope selection in onboarding.** After token auth succeeds inside each
integration step, the same step loads its sources and shows them as selectable
chips with smart defaults pre-selected. `Continue →` is gated on `≥ 1` source
selected. Auth and scope become one act, the wall disappears.

## Scope of this plan

**In scope:**
- `StepSlack` — load channels after `auth.test` succeeds, show inline chip picker, pre-select top 5 by recent message activity
- `StepGitHub` — load repos after viewer fetched, show inline chip picker, pre-select top 5 by recent push activity
- `StepJira` — load projects after auth, show inline picker, pre-select projects with assignees on the user's team (fall back to top 5 by recent issue activity)
- `StepLinear` — load teams after auth, show inline picker, pre-select all teams the user is a member of
- Continue button gating: `disabled` until auth passed AND `≥ 1` source selected. Skip-for-now still allowed (for users who deliberately want to defer one integration)
- Settings panels stay (advanced edit surface), just no longer the only place selection happens
- A friendlier no-sources error path in `pipeline.ts` if the user skipped all integrations

**Not in scope:**
- Auto-running the first pulse without confirmation (user still chooses to trigger it)
- Changing the OAuth flow itself
- Any new "smart suggestion" UI in `FirstRun` — the scope picker work happens earlier
- Just-in-time picker at pulse trigger (option B from the brainstorm — explicitly deferred; if the inline-in-onboarding fix lands clean, this becomes unnecessary)
- Selection sync across devices

## What already exists (reuse, don't reinvent)

- Chip toggle pattern: `Settings.tsx:300-318` (Slack) and `Settings.tsx:347-365` (GitHub) — the `rounded-full border px-3 py-1 text-xs` pill with `bg-ink text-canvas` for active state. Lift this into a shared `<SourceChip>` primitive under `src/components/onboarding/primitives.tsx`.
- Source listers: `slack.listPublicChannels()`, `github.listUserRepos()`, `jira.listProjects()`, `linear.listTeams()` — already implemented for Settings. Reuse, don't refetch logic.
- Onboarding primitives: `Title`, `Lede`, `Field`, `PrimaryButton`, `GhostButton`, `StatusLine`, `StepFooter` — already in `src/components/onboarding/primitives.tsx`.
- Config writer: `setConfig({ selected_slack_channels: ... })` from `src/services/db.ts`.
- Activity-ranking signal for Slack: `slack.listPublicChannels()` returns channels — we need a ranker. Can use `slack.conversations.history` with `latest=now, oldest=now-7d, limit=1` per channel, but that's `n` calls. Cheaper: sort by `num_members` desc as a v1 proxy, defer activity-based ranking to a follow-up TODO.
- Activity-ranking for GitHub: `repos.list_for_authenticated_user` already returns `pushed_at` — sort by it desc.

## ASCII wireframes (text mockups)

### StepSlack — post-auth state with inline channel picker

```
┌────────────────────────────────────────────────────────────────────────┐
│  ← Keepr  ·  ← Back  ·  01 MODEL · 02 SLACK · 03 GITHUB · 04 JIRA …   │  <- progress rail
│                                                                        │
│                                                                        │
│   Bring your own Slack app.                       (serif, ~38px)       │
│                                                                        │
│   Keepr doesn't distribute a Slack app — you install one inside        │
│   your own workspace, so your bot token stays between you and          │
│   Slack. About two minutes.                                            │
│                                                                        │
│   01  Open api.slack.com/apps and click Create New App → ...           │
│   02  Pick your workspace, then paste the manifest below ...           │
│   03  On the app page, click Install to Workspace and approve.         │
│   04  Open OAuth & Permissions, copy the Bot User OAuth Token …       │
│                                                                        │
│   ┌─ MANIFEST.YML ─────────────────────────  Copy · Download ─┐        │
│   │ display_information:                                       │        │
│   │   name: Keepr (internal)                                   │        │
│   │   ...                                                       │        │
│   └────────────────────────────────────────────────────────────┘        │
│                                                                        │
│   Slack bot token                                                      │
│   ┌──────────────────────────────────────────────────────────┐         │
│   │ xoxb-••••••••••••••••••••••••••••••••                     │         │
│   └──────────────────────────────────────────────────────────┘         │
│                                                                        │
│   ✓ Connected to acme.                       (ink-soft, small)         │
│                                                                        │
│   ────────────────────────────────────────────────────────────         │
│                                                                        │
│   Pick channels to read.                          (serif, ~24px)       │
│                                                                        │
│   We pre-selected your five most active public channels. Adjust        │
│   freely — you can change this anytime in Settings.                    │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────┐         │
│   │ Filter channels…                                          │         │
│   └──────────────────────────────────────────────────────────┘         │
│                                                                        │
│   5 / 10 SELECTED  ·  RECOMMENDED                                      │
│                                                                        │
│   ●#eng-platform   ●#eng-frontend   ●#design-crit                      │
│   ●#product-roadmap   ●#incidents   ○#engineering   ○#dx              │
│   ○#standup-team-a  ○#standup-team-b  ○#ml-research  ○#data-eng       │
│   ○#design-systems  ○#mobile         ○#infra        ○#sre             │
│                                                                        │
│   ↑ Top 15 of 87 by activity, plus your selections                     │
│                                                                        │
│   Show all 87 channels                                                 │
│                                                                        │
│   (when filter is typed: chip grid updates to show matches             │
│   anywhere in the workspace, e.g. typing "data" surfaces                │
│   #data-eng, #data-platform, #data-science even if they're              │
│   not in the top 15. Label becomes: SHOWING 3 OF 87 · "data")          │
│                                                                        │
│   ┌────────────────────────────────────────────────────────┐           │
│   │  Test & save          Skip for now      [Continue →]   │           │
│   └────────────────────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────────────────────┘
```

Selected chips: solid ink background, canvas text. Unselected: hairline border,
ink-soft text. Hover: border darkens to ink/25.

### StepGitHub — post-auth state with inline repo picker

```
   Connect GitHub.                                  (serif, ~38px)

   Keepr reads pull requests and reviews from the repos you pick. ...

   [Personal access token | Device flow]   (mode tabs)

   GitHub personal access token
   ┌──────────────────────────────────────────────────────────┐
   │ ghp_••••••••••••••••••••••••••••••••                       │
   └──────────────────────────────────────────────────────────┘

   ✓ Connected as raghavan-vm.

   ────────────────────────────────────────────────────────────

   Pick repos to read.                              (serif, ~24px)

   We pre-selected the five repos with the most recent commits. Add
   or remove any — you can adjust this anytime in Settings.

   ┌──────────────────────────────────────────────────────────┐
   │ Filter repos…                                             │
   └──────────────────────────────────────────────────────────┘

   5 SELECTED  ·  RECOMMENDED FROM RECENT PUSHES

   ●keeprlabs/keepr     ●keeprlabs/keepr-cli     ●acme-corp/api
   ●acme-corp/web       ●acme-corp/mobile        ○acme-corp/legacy
   ○acme-corp/scripts   ○acme-corp/docs          ...

   Load 23 more repos

   ┌────────────────────────────────────────────────────────┐
   │  Test & save          Skip for now      [Continue →]   │
   └────────────────────────────────────────────────────────┘
```

### StepJira / StepLinear — same pattern

Same inline picker shape after auth. Jira: pre-select projects with active
assignees from the team. Linear: pre-select teams the authed user belongs to.

### Smart defaults + search (v1)

**Ranking signal (v1):** member-count proxy. After fetching the channel list, sort
by `num_members` desc, exclude channels named `#random`, `#general`, `#announcements`
(too generic), pre-select the top 5. Label: `5 / 10 SELECTED · RECOMMENDED`. Drop
the "FROM RECENT ACTIVITY" suffix until we wire real activity ranking. Add a TODO.

**Visible vs full workspace:** show the top 15 ranked channels as visible chips by
default (NOT 50 — keep the page scannable). The pre-selected 5 are always visible
even if outside the top 15 by ranking (pinned to the top of the chip grid).

**Search behavior (first-class):** the filter input searches across the **full
channel list**, not just the visible 15. As the user types:
- Any channel matching the substring (case-insensitive, on `name`) appears in the
  chip grid, regardless of ranking position
- A small mono label below the input updates: `SHOWING 4 OF 87 · "eng"`
- Clearing the input restores the default top-15 + selected view
- Search is debounced 120ms

**"Show all" affordance:** the `Show all 87 channels` text-link below the chip grid
expands the visible set to the entire workspace, sorted alphabetically. Persists for
the rest of the session. Replaced with `Show recommended only` once expanded.

**Same model for GitHub repos / Jira projects / Linear teams:** same UI shape, same
search semantics. GitHub uses `pushed_at` for ranking (real activity, free). Linear
uses team membership. Jira uses recent assignee activity if cheap, else alphabetical.

### Accessibility & window-resize spec

**Keyboard navigation:**
- `Tab` order: token field → Test & save → (after success) Filter input → first chip → ... → last chip → "Show all" link → Skip for now → Continue.
- Each `<SourceChip>` is reachable by Tab and toggled with `Space`. `Enter` does not toggle (reserved for form submit semantics).
- Filter input: typing narrows the visible chip list. `Escape` clears the filter and returns focus to the input.
- "Continue →" gated state: when `aria-disabled="true"`, Tab still lands on it and Space/Enter shows the tooltip "Pick at least one channel, or skip this step." (does not advance).

**Screen reader semantics:**
- Section header is `<h2>`. The lede uses `<p>`.
- `<ChipGrid>` is `role="group"` with `aria-label="Slack channels to read"` (or repos / projects / teams).
- The selected count label is inside `<div role="status" aria-live="polite">` so toggling a chip announces the new count.
- Auth confirmation `Connected to acme.` is in `aria-live="polite"` so it's announced when the scope section appears.
- Loading skeleton: `aria-live="polite"` announces "Loading channels…" once when shown.
- Stale warnings ("Removed: #foo") announced once via `aria-live="polite"` on first render after re-test.

**Color contrast:**
- Channel/repo names in chips use `text-ink` (selected, on ink bg = canvas text, ratio ~14:1) and `text-ink-soft` (unselected, on canvas, ratio ~12:1). Both pass WCAG AA.
- The mono uppercase count label (`text-ink-faint` ~3.6:1) is acceptable per WCAG large/decorative non-essential text rules, but the selection count itself should also appear in `text-ink-muted` (~7:1) for the numeric value. Use: `<span class="text-ink-muted">5 / 10</span> SELECTED ...`.
- Stale warning text uses `text-ink-soft` (not red — this is a soft-failure message, not a danger).

**Focus on auth success:**
- Focus moves to the filter input of the newly mounted scope section (after the 180ms rise transition completes), `prefers-reduced-motion: reduce` skips the transition but still moves focus.
- Rationale: filter input is the most useful starting point — typing immediately narrows the list. Moving focus to the section header would be silent for keyboard users; moving to the first chip would skip the filter.

**Window resize behavior (Tauri desktop):**
- Min window width is the existing onboarding constraint (`max-w-[680px]` content column on `md+`, scales down on narrower windows). Plan: chip grid wraps naturally via `flex flex-wrap gap-2`. Filter input and section header remain full-width up to the column max.
- At very narrow windows (<400px), the count label may wrap to two lines — acceptable, not worth a media query.
- Test cases: 1280×800 (default), 800×600 (small), 1920×1080 (large). All use the same centered ~640-680px content column; only side margins change.

### Design system additions

The following primitives are added to `src/components/onboarding/primitives.tsx`. Each must compose with existing primitives (`Field`, `Title`, `Lede`, `StepFooter`) without overriding their tokens.

- `<SourceChip checked label onChange disabled />` — the toggleable pill. Lifts `Settings.tsx:300-318` styles verbatim. Renders `<button role="checkbox" aria-checked={checked} aria-disabled={disabled}>` with the existing rounded-full + ink fill / hairline border treatment. Used by all four integration steps.
- `<ChipGrid>{children}</ChipGrid>` — `flex flex-wrap gap-2` container with `aria-label` for the group.
- `<FilterInput value onChange placeholder />` — wraps the existing `Input` primitive, fixed width `w-full`, no icon.
- `<ScopeSection title lede countLabel>{children}</ScopeSection>` — the section shell with the hairline separator, scroll-into-view ref, h2 header, and lede.

Flag: there is no `DESIGN.md` in the repo. This plan establishes the de-facto vocabulary; recommend a follow-up TODO to extract `DESIGN.md` from `globals.css` tokens + `primitives.tsx` so future contributors don't drift.

### Visual language guardrails (anti-slop)

- "Show all 87 channels" is a `text-xs text-ink-muted hover:text-ink underline-offset-4` text-link. NOT a button, NOT an accordion chevron, NOT a card-style disclosure.
- The filter input uses the existing `Input` primitive from `onboarding/primitives.tsx`. No icon inside the input. Placeholder is `Filter channels…` (lowercase, ellipsis).
- The selected count label `5 / 10 SELECTED · RECOMMENDED FROM RECENT ACTIVITY` uses the existing mono uppercase pattern (`mono text-xxs uppercase tracking-[0.14em] text-ink-faint`). Single line. The middle dot is U+00B7 with thin spaces.
- No emoji anywhere. No icon next to channel names (Slack's `#` prefix is already the convention).
- No colored background on the section. Same `bg-canvas` as the rest of the page.
- The "Removed: #foo" inline warning is plain ink-soft text with no exclamation mark, no warning icon. Quiet.

### User journey — Slack step storyboard

| # | User does | User feels | What plan delivers |
|---|-----------|------------|--------------------|
| 1 | Lands on StepSlack after StepLLM | "Another integration. Hope this is short." | Existing concise lede + 4-step BYO-app guide. Nothing changes here. |
| 2 | Creates Slack app, copies token, pastes, clicks Test & save | Slight tension — "did I do it right?" | Inline `Connected to acme.` confirmation in ink-soft with a check glyph. |
| 3 | Page extends, scope section rises in with smart defaults pre-selected | Relief — "oh, it already knew what to pick" | Smart defaults are the gift. The user doesn't have to think. |
| 4 | Glances at the 5 selected, removes 1 (`#standup-team-a` — too noisy), adds 1 (`#dx`) | "I'm tweaking, not building from scratch" | Cheap toggles, immediate visual feedback, no save spinner per click (debounced batch write to config). |
| 5 | Clicks Continue → | Done with Slack. Real progress. | Continue is solid ink, primary affordance. Step advances. |
| 6 | Finishes onboarding, lands on FirstRun, clicks Run first pulse | "Let's see if this thing works" | Pulse runs successfully on the channels they just picked. **The wall is gone.** |

5-second visceral: "I see what to do." 5-minute behavioral: "I changed my mind about a chip and it just worked." 5-year reflective: "Keepr was honest about what 'connected' means."

### Scope picker — state matrix

Applies to all four integrations (Slack/GitHub/Jira/Linear). State is per-picker.

| State | What user sees | Notes |
|-------|----------------|-------|
| **idle** (pre-auth) | Scope section not rendered | Same as today's StepSlack |
| **loading** | Section header + lede + skeleton: 8 grayed pill placeholders (hairline borders, no text), `aria-live="polite"` "Loading channels…" announced once | Animation: subtle 1.2s opacity pulse. NOT a spinner — quieter. |
| **loaded (recommended)** | Smart defaults pre-selected (5 chips with `bg-ink text-canvas`), remainder unselected, count label shows `5 / 10 SELECTED · RECOMMENDED FROM RECENT ACTIVITY` | Default state. Continue enabled. |
| **loaded (user edited)** | User toggled at least one chip → label changes to `N / 10 SELECTED` (drops the "RECOMMENDED" suffix) | Acknowledges they took control. |
| **empty** (0 channels exist) | Section shows: "Your workspace has no public channels yet. You can connect a channel after onboarding via Settings." with "Skip for now" auto-focused | Rare but real. Don't block. |
| **partial / paginated** | Show first 50 most-active items by default; `Show all 87 channels` text-link expands the list. Filter input always visible. | 50 is the soft cap to keep the page scannable. |
| **fetch error** (auth dropped, network) | Section shows: "Couldn't load channels — `<error message>`. Re-test the token above, or skip for now." with a small `Retry` ghost button. Keep prior selection if any. | Don't lose user state. |
| **fetch error (scope missing)** | Specialized message: "Slack rejected our `channels:read` scope. Reinstall the app after updating the manifest." links to manifest section above. | Keep the existing diagnostic copy from `StepSlack.tsx:75-81`. |
| **re-test after token change** | After successful re-test, diff new list against current selection. Channels/repos still present stay selected. Vanished items shown as a small ink-soft inline warning: `Removed: #foo (no longer accessible).` Continue stays enabled. Selection IS NOT silently wiped. | Honors user intent for fixed-scope re-tests; catches workspace mismatch. |
| **continue gated** | When `selectedCount === 0`, Continue button is disabled with `aria-disabled="true"` and tooltip "Pick at least one channel, or skip this step." Skip-for-now remains enabled. | Affordance: 0 selected = continue dim; ≥1 = continue solid ink. |

### Information architecture details

- Scope section is hidden (not just disabled) until `auth.test` succeeds. The page first renders identically to today's StepSlack — title, lede, manifest, token field, primary button. No empty state shouting "you have no channels yet."
- On auth success, the scope section mounts with a 180ms `rise` transition (existing utility) and `scrollIntoView({ behavior: "smooth", block: "start" })` is called on the new section header so the user's eye follows the change.
- Visual separator between auth zone and scope zone: full-width `border-top: 1px solid var(--hairline)` with 32px top padding and 24px bottom padding inside the scope section. NOT a horizontal rule with text in the middle (too ornamental).
- The scope section header is `<h2>` (not `<h1>` — that's still "Bring your own Slack app"). Visual: serif, ~24px, weight 400, ink color.

### Skip-for-now behavior

If user clicks "Skip for now" on an integration:
- Any selections already made on this step **persist** (they were written to config during the toggle; skip does not undo).
- Step advances without requiring a scope.
- If NO selection exists AND no other integration is configured, the first-pulse error shows the improved "Open Settings (⌘,)" copy.

Rationale: "skip" means "I haven't committed to a final decision", not "undo everything". If a user picked 3 channels then skipped, their 3 picks still work. They can refine in Settings anytime.

## File-level changes

- `src/components/onboarding/primitives.tsx` — add `<SourceChip>`, `<ChipGrid>`, `<FilterInput>`, `<ScopeSection>` primitives
- `src/components/onboarding/useScopePicker.ts` — **new** shared hook. Takes `integration: 'slack' | 'github' | 'jira' | 'linear'` and returns `{ state, items, visibleItems, selected, toggle, filter, setFilter, expandAll, staleItems }`. Owns: list-fetch state machine (idle/loading/loaded/empty/error), smart-defaults computation, `setConfig` flush, search debounce (120ms), stale-diff on re-test. Per-integration adapter table inside the hook maps: lister fn, identity field, ranking signal, exclusion list. One place to fix any picker bug.
- `src/components/onboarding/StepSlack.tsx` — after `auth.test` ok, call `useScopePicker('slack')`, render with `<ScopeSection>` + `<ChipGrid>` + `<SourceChip>`. Gate Continue on `selected.length >= 1`.
- `src/components/onboarding/StepGitHub.tsx` — same pattern, `useScopePicker('github')`
- `src/components/onboarding/StepJira.tsx` — same, `useScopePicker('jira')`
- `src/components/onboarding/StepLinear.tsx` — same, `useScopePicker('linear')`
- `src/services/pipeline.ts:513-517` — improve error copy only: `"No data sources selected. Open Settings (⌘,) and connect at least one Slack channel, GitHub repo, Jira project, or Linear team."` No new error subclass, no event bus. (Deeplink explicitly dropped — see Architecture Review.)
- `src/screens/Settings.tsx:294, 340` — auto-load channels/repos ONLY on first open when `cfg.selected_slack_channels` / `cfg.selected_github_repos` is empty. Otherwise keep the existing explicit "Load public channels" / "Load my repos" buttons, relabeled to `Reload` when list is already loaded. Power users with 200+ channels don't pay a fetch tax on every Settings visit.

## Settings.tsx refactor (DRY follow-through)

After the onboarding primitives + `useScopePicker` land, refactor `Settings.tsx:281-367` (Slack and GitHub panels) to use the SAME `<ChipGrid>` + `<SourceChip>` + `useScopePicker('slack')` / `useScopePicker('github')`. The Settings panel is functionally identical to the onboarding picker minus the auth zone. One source of truth for the chip UX. Same for Jira / Linear panels (`Settings.tsx` lines covering those panels).

## Search behavior — pure client-side

Search debounce filters the already-loaded `items` array in memory only. NO additional API calls fire as the user types. `useScopePicker` exposes `setFilter(query)` which writes to a local state; `visibleItems` is `useMemo`'d off `[items, filter, expanded, selected]`.

## Identity fields (for stale-diff on re-test)

Per integration, the stable identity used to diff new list against current selection:

| Integration | Identity field | Notes |
|-------------|----------------|-------|
| Slack | `channel.id` | Immutable; Slack never reuses. |
| GitHub | `full_name` (`owner/repo`) | Accept rare false-positive on repo rename. Repo transfers cause legitimate stale-warning. |
| Jira | `project.key` | Immutable per Jira semantics. |
| Linear | `team.key` | Stable within a workspace. |

## Smart-defaults config flush (race fix)

When the list finishes loading and smart defaults are computed, `useScopePicker` MUST call `setConfig({ [field]: defaults })` **synchronously in the same effect** (not via the debounced toggle path). Rationale: user may click Continue before touching any chip; if defaults live only in component state, config is empty when `pipeline.ts` reads it later.

Unit test requirement: mount StepSlack, simulate auth success, simulate channels loaded, immediately read `getConfig()` → assert `selected_slack_channels.length === 5` without any toggle event.

## Deferred design decisions (TODOs)

| Decision | If deferred, what happens | Recommended owner |
|----------|---------------------------|-------------------|
| Real activity-based ranking for Slack | v1 ships with member-count proxy; for users with mostly-equal channel sizes, recommendations are weak. Two-click recovery via filter+toggle. | Follow-up TODO. |
| `DESIGN.md` extraction from globals.css + primitives.tsx | Future contributors drift from the established vocabulary; chip styles get duplicated. | Follow-up TODO; pre-req before any third-party contributor lands UI work. |
| Activity-rank-by-background fetch (option C from the brainstorm) | Defaults stay member-count-proxy quality. Users who want better defaults edit in two clicks. | Backlog. |
| Just-in-time picker at pulse trigger (option B from the brainstorm) | Users who deliberately Skip-for-now during onboarding still see the soft error from `pipeline.ts`. Acceptable v1; revisit if telemetry shows skip rate >20%. | Backlog. |
| Sync of selections across devices | Each device has its own selection. Same as today. | Out of scope; no shared cloud state in Keepr. |

## Error handling — toggle persistence failure

`setConfig` writes go through Tauri SQL plugin. Disk full / DB locked is rare but possible. `useScopePicker.toggle()` MUST:
- Wrap `setConfig` in try/catch
- On failure: revert optimistic UI state, surface a small ink-soft inline error: `"Couldn't save selection. Try again or restart Keepr."`
- Log via the existing `logWarn` from `pipeline.ts` (whatever the equivalent log channel is for non-pipeline code — check `App.tsx`)

Add test #16 to `useScopePicker.test.ts`: mock `setConfig` to throw, toggle a chip, assert UI state reverts AND error is rendered.

## Performance considerations

- `useScopePicker` MUST `useMemo` the smart-defaults computation, the visibleItems slice, and the filtered set. Dependencies: `[items, filter, expanded, selected]`. Without memoization, every chip toggle would re-sort the full list.
- `listPublicChannels()` (`slack.ts:45-60`) currently caps at 10 pages × 200 = 2000 channels. For workspaces beyond that, our smart-defaults pick from the first 2000. Add a TODO to warn (or auto-page deeper) if workspace size > 2000.
- Filter is in-memory string match; ~1ms on 2000 items in modern V8. No web-worker needed.
- Setting auto-load (Settings.tsx) is gated on `selected_*.length === 0` per Architecture #3, so the 200-channel power-user case stays free.

## Test plan

This plan establishes the project's first test infrastructure. Future plans inherit it.

### Tooling additions (devDependencies in package.json)

- `vitest` — test runner, fast, native ESM, fits Vite-based stack
- `@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event` — render + assert primitives
- `jsdom` — DOM environment for unit tests
- Add `"test": "vitest"` and `"test:run": "vitest run"` to package.json scripts
- New `vitest.config.ts` at repo root: jsdom env, globals enabled, setupFiles points to `src/test-setup.ts` (which imports `@testing-library/jest-dom/vitest`)

### Test files (all new)

`src/components/onboarding/__tests__/useScopePicker.test.ts` — covers every branch in the coverage diagram:

| # | Test | Asserts |
|---|------|---------|
| 1 | `load() success` | items populated, smart-defaults pre-selected (5 chips), `setConfig` called synchronously with the 5 IDs |
| 2 | `load() empty` (lister returns []) | state = "empty", no `setConfig` call, label not rendered |
| 3 | `load() missing-scope error` | state = "error", error message includes "channels:read" string |
| 4 | `load() network error` | state = "error", generic retry button rendered |
| 5 | `toggle() add` | item appears in selected, `setConfig` flush after 120ms debounce |
| 6 | `toggle() remove` | item leaves selected, label drops "RECOMMENDED" suffix on first user toggle |
| 7 | `reTest() identical list` | selection unchanged, no staleItems |
| 8 | **CRITICAL — REGRESSION TEST** `reTest() with vanished items` | items still present stay selected, vanished surface in `staleItems`, no silent wipe |
| 9 | `reTest() workspace mismatch` (all IDs different) | all prior selections in staleItems, none in selected |
| 10 | `setFilter("eng")` | visibleItems narrowed by substring match, no API call fired (verify via mock counter) |
| 11 | `setFilter("")` | visibleItems restored to top-15 + selected |
| 12 | `expandAll()` | visibleItems = full list, sorted alphabetically |
| 13 | **CRITICAL — RACE FIX TEST** `Continue clicked immediately after load` | Read `getConfig()` before any toggle event → assert `selected_slack_channels.length === 5` |
| 14 | `Slack identity` | uses `channel.id`, two channels with same name but different IDs treated separately |
| 15 | `GitHub identity` | uses `full_name`, repo rename appears as stale (acceptable false-positive) |

`src/components/onboarding/__tests__/StepSlack.test.tsx` — render-level integration:

| # | Test | Asserts |
|---|------|---------|
| 1 | Pre-auth render | scope section NOT in DOM |
| 2 | Post-auth render | scope section appears, focus on filter input within 200ms |
| 3 | Continue button gating | disabled when `selectedCount === 0`, enabled at `>= 1` |
| 4 | Skip-for-now after picks | selections persist (mock setConfig assertion), step advances |

`src/services/__tests__/pipeline.test.ts` — pipeline error copy regression:

| # | Test | Asserts |
|---|------|---------|
| 1 | **REGRESSION** No sources configured | throws Error with new copy: matches `/Open Settings.*⌘,/` |
| 2 | Some sources configured but zero items returned | existing detailed error path still triggers |

`src/screens/__tests__/Settings.test.tsx` — auto-load regression:

| # | Test | Asserts |
|---|------|---------|
| 1 | Mount with empty `selected_slack_channels` | listPublicChannels called once on mount |
| 2 | **REGRESSION — power user case** Mount with 5 selected channels | listPublicChannels NOT called on mount; "Reload" link visible instead |

### Mocking strategy

- Mock `src/services/db.ts` (`setConfig` / `getConfig`) with vitest `vi.mock`. Each test gets a fresh fake config.
- Mock `src/services/slack.ts`, `github.ts`, `jira.ts`, `linear.ts` listers — return canned arrays.
- No real network. No real Tauri APIs. Hook is pure React + service calls.

### Manual verification (still required)

Automated tests cover logic. Manual covers the actual Tauri shell.

- Fresh install → real flow → finish onboarding with defaults accepted on each step → click Run first pulse → pipeline runs without "no sources" error.
- Fresh install → real flow → skip Slack but select 1 GitHub repo → finish → first pulse runs with GitHub-only data.
- Fresh install → real flow → skip ALL integrations → finish → first pulse shows new "Open Settings (⌘,)" error copy.
- Fresh install → real flow → use a Slack token, paste it, get a missing-scope error, fix scopes, re-test, confirm prior picks (if any) persist.
- Existing screen `Settings.tsx` still allows full edit.

### Coverage target

- Lines: aim 85%+ for `useScopePicker.ts` (the new shared brain), 70%+ for the modified step components. The race-fix test (#13) and the stale-diff test (#8) MUST exist regardless of coverage percentage.
- Add `"test:coverage": "vitest run --coverage"` and require `@vitest/coverage-v8` in devDeps.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 11 issues (5 arch + 3 quality + 0 perf-blockers + 3 obvious-fix), 0 critical gaps, 0 unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score 6/10 → 9/10, 2 decisions made, 5 deferred TODOs |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0
**VERDICT:** DESIGN + ENG CLEARED — ready to implement.
