# Plan: Distinguish pulse outcomes — silence, partial failure, total failure

## Problem

`src/components/RunOverlay.tsx:96-102` has exactly two terminal titles:

```tsx
{isError ? "Something went sideways." : isDone ? "Ready." : `${LABELS[state.stage]}…`}
```

The `isError` branch fires whenever `runWorkflow` throws — which today includes
the `allItems.length === 0` case (`pipeline.ts:519-534`). But **at least three
different things** can happen at the end of a pulse, and users respond to each
differently:

1. Every fetch succeeded and the window genuinely had no activity (team was
   quiet). Not an error.
2. Some sources failed (auth, permission, network), others were merely empty
   in the window. Mixed signal — user needs a per-source breakdown.
3. Every source failed (token expired, offline). Actionable error.

All three today surface as **"Something went sideways."** with a single
diagnostic string — so a quiet week looks identical to a broken token, and
the actual signal ("Slack bot isn't in the channels") is hidden behind copy
like `Fetched from 5 repo(s) + 9 channel(s)… but got zero items. This usually
means the Slack bot token can't read the selected channels…`

### Concrete case (from logs `~/Library/Logs/app.keepr.desktop/keepr.log`)

Real run captured `2026-04-24`:

```
fetch: GitHub: exlodev/exlo-revamp → 0 PRs        (5 repos, all 0)
slack fetch failed (#social): Slack conversations.history: not_in_channel
slack fetch failed (#all-exlo): Slack conversations.history: not_in_channel
... × 9 channels
fetch: Jira: CC → 0 issues                         (4 projects, all 0)
fetch: Linear: SAG → 0 issues                      (1 team, 0)
prune: Pruning 0 raw items
→ Error: Fetched from 5 repo(s) + 9 channel(s) + 4 Jira project(s) + 1 Linear team(s) but got zero items…
```

Truth the user needs: Slack is broken (bot not a member of its channels);
everything else was legitimately quiet. Current UI flattens that into one
alarming headline.

## Fix direction (chosen)

**Three-state pulse outcome with per-source status.** Pipeline accumulates a
`SourceStatus[]` through the fetch phase instead of throwing a single `Error`
on empty. The overlay reads the outcome and picks one of three states:

- **Quiet week** (A) — every fetch `ok_empty`. Calm tone, "try longer window" primary action.
- **Partial failure** (B) — at least one fetch failed AND at least one succeeded. Per-source list with warnings only on the broken ones.
- **Total failure** (C) — every fetch failed. Same list, all errors. "Fix in Settings" primary action.

Only the `hasAnySources === false` branch remains a real thrown error (user
hasn't configured anything).

## Scope of this plan

**In scope:**

- New `PulseOutcome` return shape from `runWorkflow` covering success / empty / partial_failure / total_failure.
- Per-source status accumulation through the fetch loop — one `SourceStatus` per repo/channel/project/team, carrying `kind`, `name`, outcome, user-language `detail`, and `fixAction` hint.
- `RunOverlay.tsx` renders three new terminal states with the per-source row component (reusable across all three).
- `StepSlack.tsx` gets a new numbered step 05: "Invite the bot to each channel — type `/invite @Keepr` in the channel." This is the upstream fix for the most common cause of State B.
- "Try a longer window" action — triggers a fresh `runWorkflow` with `daysBack` doubled (capped at 90).
- "Fix in Settings" action — navigates to Settings (reuses whatever the current shortcut is).
- User-language error translation: map the raw API strings (`not_in_channel`, `invalid_auth`, `401 Bad credentials`, `410 Gone`, network errors) to one-line human copy. One central table — no scatter.

**Not in scope:**

- Auto-joining Slack channels via `conversations.join` (requires manifest scope change — separate follow-up).
- "Your team was active N days ago" historical hint on the quiet-week state (needs a lookback query we don't have).
- Retry button. If Keepr just ran and got nothing, immediate retry won't help. "Try longer window" is the real retry.
- Rewriting the stage-checklist progress UI during the run (mid-flight progress stays as-is).
- Changing any of the fetchers themselves.

## What already exists (reuse, don't reinvent)

- Fetch loop already wraps each source in try/catch and calls `logWarn` on failure (`pipeline.ts:424-502`). We're replacing the log-and-forget with status accumulation, not restructuring the loop.
- `RunOverlay.tsx` already switches on `stage` — adding three terminal stages is the same pattern.
- `StatusLine` primitive (`onboarding/primitives.tsx:81-108`) already has `ok`/`err` variants with inline icons. Reuse for the per-source row.
- Stage progression uses a serif title (`display-serif-lg text-[28px]`) — the new titles use the same type token.
- App.tsx:220 dispatcher already pipes errors into RunOverlay — we change the shape of what gets dispatched, not the plumbing.
- `pipeline.ts:514-516` empty-sources error (from the `onboarding-scope-picker` plan) stays as-is. This plan only changes the `allItems.length === 0` branch.

## ASCII wireframes

### State A — Quiet week (all fetches ok, zero items)

```
┌──────────────────────────────────────────────────────┐
│  ⌘  KEEPR                                            │
│                                                      │
│  Quiet week.                        (serif, 28px)    │
│                                                      │
│  Keepr checked 5 repos, 9 channels, 4 Jira projects, │
│  and 1 Linear team for the last 14 days. Nothing     │
│  new to summarize.                                   │
│                                                      │
│  ✓  GITHUB     5 repos       no PRs in window        │
│  ✓  SLACK      9 channels    no messages             │
│  ✓  JIRA       4 projects    no updates              │
│  ✓  LINEAR     1 team        no issues               │
│                                                      │
│  [ Try 30 days ]   [ Adjust sources ]       Dismiss  │
└──────────────────────────────────────────────────────┘
```

- Serif title, ink, no punctuation alarm.
- Body is factual — names what Keepr did, not what went wrong (because nothing did).
- Green check `bg-ink-soft/20` on each source row (not `bg-ink/20` — too heavy).
- Right column: one-line `text-ink-faint` describing the empty state in user language.
- Primary action `[ Try 30 days ]` — solid-ink ghost button. Doubles `daysBack` up to 90, re-runs.
- Secondary `[ Adjust sources ]` — hairline ghost. Navigates to Settings.
- `Dismiss` — tertiary text link, right-aligned.

### State B — Partial failure (what the screenshot user hit)

```
┌──────────────────────────────────────────────────────┐
│  ⌘  KEEPR                                            │
│                                                      │
│  Couldn't reach your Slack.        (serif, 28px)     │
│                                                      │
│  Keepr ran, but 9 Slack channels returned a          │
│  permission error. The other sources were quiet      │
│  for the last 14 days.                               │
│                                                      │
│  ⚠  SLACK      9 channels    bot not in channel —    │
│                              invite @Keepr to each → │
│  ✓  GITHUB     5 repos       no PRs in window        │
│  ✓  JIRA       4 projects    no updates              │
│  ✓  LINEAR     1 team        no issues               │
│                                                      │
│  [ Fix in Settings ]   [ Try 30 days ]      Dismiss  │
└──────────────────────────────────────────────────────┘
```

- Title names the dominant failure ("Couldn't reach your Slack" — the one broken source by name). Plural if more than one source kind is broken: "Couldn't reach 2 of your sources."
- Warning row uses `⚠` glyph (`text-ink-soft`, not a red danger color — this is not destructive, just informational).
- The `invite @Keepr to each →` is a link to a help doc OR a modal that lists the channels with copy-paste `/invite @Keepr` commands. v1: just text, no link. (See TODO.)
- Healthy sources still show their checks — preserves the truth that GitHub/Jira/Linear are fine.
- Primary action `[ Fix in Settings ]` navigates to Settings Slack panel. `[ Try 30 days ]` still available (useful when the partial-failure was just Slack and the user wants longer windows of GitHub history regardless).

### State C — Total failure

```
┌──────────────────────────────────────────────────────┐
│  ⌘  KEEPR                                            │
│                                                      │
│  Keepr couldn't reach any sources.  (serif, 28px)    │
│                                                      │
│  Every source returned an error. Usually this means  │
│  a token expired or you're offline.                  │
│                                                      │
│  ✗  GITHUB     5 repos       401 unauthorized        │
│  ✗  SLACK      9 channels    invalid_auth            │
│  ✗  JIRA       4 projects    network offline         │
│  ✗  LINEAR     1 team        network offline         │
│                                                      │
│  [ Fix in Settings ]                         Dismiss │
└──────────────────────────────────────────────────────┘
```

- `✗` glyph (`text-ink-soft` or `text-danger` — v1 goes `text-ink-soft` for visual coherence with the rest of the app; no red until we have a defined danger token).
- No "Try longer window" — pointless if nothing can be reached at all.
- One primary action. `Dismiss` stays as an escape hatch.

### Per-source row — shared component

```
  ✓  GITHUB     5 repos       no PRs in window
  ⚠  SLACK      9 channels    bot not in channel — invite @Keepr →
  ✗  LINEAR     1 team        network offline
 ^   ^          ^              ^
 │   │          │              └─ detail: text-ink-faint text-xs
 │   │          └─ unit count: mono text-xxs uppercase
 │   └─ kind label: mono text-xs uppercase tracking-[0.14em]
 └─ status glyph: 18×18 circle, subtle border, icon inside
```

Layout: `flex items-center gap-4` with the glyph, kind column fixed at `w-20`, count column fixed at `w-24`, detail column `flex-1`.

## Pulse outcome — state matrix

| Outcome | Fetchers result | Title | Primary action | Shows stage checklist? |
|---------|-----------------|-------|----------------|------------------------|
| `ready` | At least one item synthesized | `Ready.` | Open session | Yes — all checks |
| `empty` | All sources `ok_empty` | `Quiet week.` | Try 30 days | **No** — hide entirely |
| `partial_failure` | Mix of `ok_*` and errors | `Couldn't reach {source-or-count}.` | Fix in Settings | **No** |
| `total_failure` | All sources errored | `Keepr couldn't reach any sources.` | Fix in Settings | **No** |
| `no_sources_configured` | Thrown at `pipeline.ts:514` (existing) | Same as today | Same as today | Stays as generic error — separate wall |

Hiding the stage checklist on empty/partial/total is deliberate: the 5-step progress (gathering → filtering → summarizing → thinking → writing) is process UI meant for the running state. Showing it at rest implies something was "in progress" that got interrupted — which is wrong for a quiet-week state.

## User-language error translation

One source of truth. New file `src/services/sourceDiagnostic.ts`:

```ts
export type SourceErrorKind =
  | "not_in_channel"      // Slack: bot isn't a member
  | "missing_scope"       // Slack: token missing channels:read etc
  | "invalid_auth"        // Slack: bad/expired token
  | "unauthorized"        // GitHub: 401 Bad credentials
  | "rate_limited"        // any: 429
  | "project_not_found"   // Jira: 404 / 410 Gone
  | "network"             // fetch threw before HTTP
  | "unknown";            // fallback — includes raw message

export function classifyError(
  source: "slack" | "github" | "jira" | "linear",
  err: unknown,
): { kind: SourceErrorKind; detail: string; fixAction?: "settings" | "invite_bot" | "renew_token" };
```

The `detail` field returns the user-facing one-liner (`"bot not in channel — invite @Keepr to each"`), NOT the raw API string. The raw string still gets logged via `logWarn` for debuggability. Tested end-to-end — new test file `src/services/__tests__/sourceDiagnostic.test.ts`.

## File-level changes

- `src/services/pipeline.ts`
  - Accumulate per-source results through the fetch loop, then collapse to one `SourceKindStatus` per kind via the aggregation rule above.
  - Each `try` block records the source's individual outcome; each `catch` calls `classifyError(source, err)`.
  - Existing `logWarn` calls stay — they preserve the raw API string + per-source granularity for diagnosis.
  - New return shape `PulseOutcome` (see contract above). The `allItems.length === 0` branch at `pipeline.ts:519` no longer throws — it returns `{ kind: "empty" | "partial_failure" | "total_failure", sources, windowDays }`.
  - The `hasAnySources === false` branch at `pipeline.ts:513` keeps throwing (separate concern from the previous PR).
  - Success path returns `{ kind: "ready", sessionId, outputPath, markdown, costUsd, sources, windowDays }`.
  - **Session row lifecycle by outcome (D1):**
    - `ready` → mark `complete` with output path (existing behavior).
    - `partial_failure` → mark `complete` with empty markdown — there's *some* result (the kinds that worked).
    - `total_failure` → mark `failed` with `error_message` set to a one-line summary like `"Every source returned an error"`.
    - `empty` → **delete the pre-created session row** via existing `deleteSession()` helper (already used for the abort path). Quiet weeks leave no clutter in the sidebar.
  - Add ONE telemetry log at the outcome classification point: `logInfo(\`pulse outcome: ${outcome.kind} — ${summarizeSources(outcome.sources)}\`)`. Free signal for future product decisions.

- `src/services/sourceDiagnostic.ts` — **new**. Exports:
  - `classifyError(source: IntegrationKind, err: unknown): { kind: SourceErrorKind; detail: string; fixAction?: FixAction }`
  - `describeEmpty(kind: IntegrationKind): string` — single source of truth for empty-state copy. The table in this plan documents the function's return values, not a separate string set.
  - `scrubSecrets(s: string): string` — **P0 from review**. Regex-replaces token patterns before any raw error string surfaces to the UI. Patterns: `xoxb-[a-zA-Z0-9-]+`, `xoxp-[a-zA-Z0-9-]+`, `ghp_[a-zA-Z0-9]+`, `github_pat_[a-zA-Z0-9_]+`, `lin_api_[a-zA-Z0-9]+`, `Bearer [^\s]+`, JWT-shaped triplets `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`. Replacement: `[redacted]`. Applied inside `classifyError` BEFORE the 80-char truncation. **Test required:** each pattern, plus a token in the middle of a longer string.
  - `summarizeSources(sources: SourceKindStatus[]): string` — formats the telemetry one-liner.

- `src/services/slack.ts` / `github.ts` / `jira.ts` / `linear.ts` — add a comment at the top of each: `// Error messages thrown from this module are consumed by src/services/sourceDiagnostic.ts. Changing the format of the Error("…") strings requires updating the classifier regexes in that file.` Prevents silent classifier drift.

- `src/components/RunOverlay.tsx`
  - Add `outcome: PulseOutcome | null` to `RunState`. The existing `stage` field stays for the running progression (fetch/prune/.../write).
  - When `state.outcome` is non-null, render the outcome view (one of three new terminal layouts). Otherwise render running progress as today. The legacy `stage === "error"` thrown-error path stays for the `no-sources-configured` case.
  - Per-source row is a small new component co-located in this file (don't promote to `primitives/` yet — see Q4 in review).
  - The stage checklist (`{STAGES.map(...)}`) is already gated by `STAGES.indexOf(state.stage) !== -1` patterns. Adding a guard `state.outcome === null` makes the hide-on-outcome explicit. Verify with the existing `done`/`error` paths still rendering correctly.
  - **New props:**
    - `onTryLongerWindow: (nextDaysBack: number) => void` — emitted from the `[Try N days]` button. Parent decides what `next` is (computed from `outcome.windowDays`).
    - `onFixInSettings: (focusKind?: IntegrationKind) => void` — emitted from `[Fix in Settings]`. If `partial_failure` has exactly one error kind, pass it through so the parent can scroll to that panel.

- `src/components/onboarding/StepSlack.tsx`
  - Add `NumberedStep n={5}` after current step 4: "In Slack, open each channel you want Keepr to read and type `/invite @Keepr` (or use the channel's `Add apps` menu). Keepr can only read channels it's a member of."
  - The manifest keeps its existing `channels:read` + `channels:history` scopes (no new scope — `/invite` from the user is the chosen path for v1).

- `src/App.tsx:183-227` (`runWithOverlay`) — handle the new return shape:
  - On success outcome (`ready`): existing post-run behavior (`setView({ kind: "session", id })`).
  - On `empty` / `partial_failure` / `total_failure`: `setRunState({ stage: "done", outcome })` so the overlay renders the outcome view. No automatic navigation.
  - Implement `onTryLongerWindow(next)` — calls `runWithOverlay({ ...args, daysBack: next })`. Reuses the existing abort-then-restart pattern at line 191.
  - Implement `onFixInSettings(focusKind)` — closes the overlay and navigates to Settings (existing `setView({ kind: "settings", focus: focusKind })` or equivalent — confirm during implementation).
  - **Demo path (`runDemoWorkflow`):** must return the same `PulseOutcome` shape, even if it always returns `kind: "ready"`. Otherwise TS will complain. One-line shim.

- `src/lib/types.ts` — `SessionStatus` already has `pending | processing | complete | failed`. No change needed; `partial_failure` reuses `complete` (because we have output, just thin), `total_failure` reuses `failed`, `empty` deletes the row.

## State contract

Pipeline aggregates per-source results into one `SourceKindStatus` per integration kind
(slack/github/jira/linear). UI renders one row per kind with no further aggregation.
Per-source detail (which exact channel failed with what raw error) stays in `logWarn`
for debugging. Decision recorded during eng review (D2).

```ts
export type IntegrationKind = "slack" | "github" | "jira" | "linear";

export type FixAction = "settings" | "invite_bot" | "renew_token";

export type SourceKindStatus = { kind: IntegrationKind; sourceCount: number } & (
  | { status: "ok_data"; itemCount: number }
  | { status: "ok_empty"; detail: string }                    // "no PRs in window"
  | { status: "error"; errorKind: SourceErrorKind; detail: string; fixAction?: FixAction; failedCount: number }
);

export type PulseOutcome =
  | { kind: "ready"; sessionId: number; outputPath: string; markdown: string; costUsd: number; sources: SourceKindStatus[]; windowDays: number }
  | { kind: "empty"; sources: SourceKindStatus[]; windowDays: number }
  | { kind: "partial_failure"; sources: SourceKindStatus[]; windowDays: number }
  | { kind: "total_failure"; sources: SourceKindStatus[]; windowDays: number };
```

`sourceCount` is the unit count for the row label (`"5 repos"`, `"9 channels"`).
For `error` rows, `failedCount` is the subset that errored (the rest may have been
ok_empty or ok_data — see aggregation rule below).

### Per-kind aggregation rule

Within a kind, multiple sources can have mixed outcomes. The pipeline collapses them
into ONE `SourceKindStatus` using this rule:

1. **At least one source returned data** → `ok_data` with `itemCount = sum of items`.
2. **All sources succeeded but all returned 0 items** → `ok_empty` with `detail` from `describeEmpty(kind)`.
3. **At least one source errored AND none returned data** → `error`. Pick the dominant `errorKind`:
   - If all errors share the same `errorKind` → use that errorKind's `detail` and `fixAction`.
   - If errors are mixed within a kind → `errorKind = "mixed"`, `detail = "{N} sources failed — check Settings"`, `fixAction = "settings"`.
4. **At least one source errored AND at least one returned data** → still `ok_data` (we have something to summarize). Errors get logged via `logWarn` but don't surface to the UI for that kind. **Rationale:** the user got a result; partial-source noise within an otherwise-working kind is debug data, not a UX moment.

Per-source detail always goes to `logWarn` regardless of aggregation. This is the
debug surface — UI gets the rollup, logs get the truth.

### PulseOutcome classification rule

After per-kind aggregation:

- Any kind is `ok_data` → `kind: "ready"`.
- All configured kinds are `ok_empty` → `kind: "empty"`.
- All configured kinds are `error` → `kind: "total_failure"`.
- Otherwise (mix of `ok_empty` and `error`, no `ok_data`) → `kind: "partial_failure"`.

Skipped kinds (user has 0 channels selected for Slack but plenty of GitHub repos)
contribute no `SourceKindStatus` entry. Don't show them in the row list.

## "Try longer window" — behavior spec

- Action button only appears on `empty` (not on partial_failure, not on total_failure).
  - Exception: `partial_failure` also gets the button when the failures are fixable-via-invite (Slack `not_in_channel`). Reason: the user might tap it expecting Keepr to cast a wider net on the sources that *are* working. v1 ships with the simpler rule — button only on `empty` — and we add the Slack case if telemetry shows users expect it.
- New `daysBack` = `min(currentDaysBack * 2, 90)`. If already at 90, button is disabled with tooltip "Already at the max 90-day window."
- Re-runs `runWorkflow` with the new `daysBack`, sessionId gets a new row (not updating the existing one). RunOverlay rises into the running state, same as initial run.

## "Fix in Settings" — behavior spec

- Closes the overlay and navigates to Settings. If `partial_failure` has exactly one broken source kind, scroll to THAT panel (Slack / GitHub / Jira / Linear).
- If multiple kinds failed, scroll to the top of Settings.
- Reuses whatever in-app navigation pattern already exists for the `⌘,` shortcut (check `src/App.tsx` for Settings routing).

## Empty-state copy per source

| Source | `ok_empty` detail |
|--------|-------------------|
| GitHub | `no PRs in window` |
| Slack  | `no messages` |
| Jira   | `no updates` |
| Linear | `no issues` |

Single source of truth: `describeEmpty(kind)` in `sourceDiagnostic.ts`.

## Error-state copy per source + kind

| Source | Kind | Detail | Fix action |
|--------|------|--------|------------|
| Slack | `not_in_channel` | `bot not in channel — invite @Keepr to each` | `invite_bot` |
| Slack | `missing_scope` | `missing scope — reinstall with updated manifest` | `settings` |
| Slack | `invalid_auth` | `token rejected — paste a fresh one` | `renew_token` |
| GitHub | `unauthorized` | `token rejected or expired` | `renew_token` |
| GitHub | `rate_limited` | `GitHub rate limit — wait a few minutes` | (none) |
| Jira | `unauthorized` | `token rejected or expired` | `renew_token` |
| Jira | `project_not_found` | `project no longer accessible — re-pick in Settings` | `settings` |
| Linear | `unauthorized` | `API key rejected — paste a fresh one` | `renew_token` |
| any | `network` | `network offline` | (none) |
| any | `unknown` | `{first 80 chars of raw error}` | `settings` |

## Accessibility & keyboard

- Per-source list is `<ul role="list">` — each row a `<li>`. The kind label (`GITHUB`) gets its real semantic weight via `<span class="mono …">`, not a heading.
- Row detail + glyph: status announced via `aria-label` on the row — e.g. `<li aria-label="Slack, 9 channels, warning: bot not in channel">`.
- Primary action button is the first focusable element after the title. `Escape` dismisses the overlay (already wired on today's overlay via `useEffect` — reuse).
- Empty-state title (`Quiet week.`) lives in `<h2>`, body in `<p>`. `aria-live="polite"` on the outcome region so screen readers announce "Quiet week" on state change from running → empty.

## Test plan

New test files — all pure, no Tauri:

### `src/services/__tests__/sourceDiagnostic.test.ts`

Per-source classification:

- Slack: `not_in_channel`, `missing_scope` / `channels:read`, `invalid_auth` / `not_authed`, unknown.
- GitHub: `401 Bad credentials`, `429`/`rate limit`, network error (no response), unknown.
- Jira: `401`, `404`/`410 Gone`, unknown.
- Linear: GraphQL "Authentication failed", network, unknown.

Token scrubber (`scrubSecrets`) — **REQUIRED FOR P0 GAP**:

- Each pattern individually: `xoxb-`, `xoxp-`, `ghp_`, `github_pat_`, `lin_api_`, `Bearer …`, JWT triplet.
- Token in middle of longer string — full string scrubbed but rest preserved.
- Multiple tokens in one string — all replaced.
- No token → string unchanged.
- Verify scrubber runs INSIDE `classifyError` before the 80-char truncation, not after.

Empty-state copy snapshot (`describeEmpty`) — one assertion per kind to catch accidental copy edits.

### `src/services/__tests__/pipeline.outcome.test.ts`

Outcome classification (with mocked fetchers via existing `pipeline.test.ts` mock pattern):

1. All fetchers return data → `kind: "ready"`, sources all `ok_data`.
2. All fetchers return `[]` → `kind: "empty"`, sources all `ok_empty`.
3. Slack throws `not_in_channel` × all channels, others return `[]` → `kind: "partial_failure"`, slack status is `error{errorKind: "not_in_channel", failedCount: N}`, others `ok_empty`.
4. Slack throws `not_in_channel`, GitHub returns 2 PRs, others `[]` → `kind: "ready"` (any kind ok_data flips total to ready). GitHub kind `ok_data{itemCount: 2}`. Slack errors logged but DON'T appear in the outcome `sources` list (per aggregation rule 4).
5. All fetchers throw non-abort errors → `kind: "total_failure"`, every kind `error`.
6. **CRITICAL — REGRESSION** abort mid-flight after some fetches succeeded → still rejects with abort error, does NOT return a `partial_failure` outcome.
7. **D1 lifecycle assertions:**
   - `ready` → `setSessionStatus("complete")` called.
   - `partial_failure` → `setSessionStatus("complete")` called (with empty markdown).
   - `total_failure` → `setSessionStatus("failed", "Every source returned an error")` called.
   - `empty` → `deleteSession(id)` called, no status update.
8. **Per-kind aggregation rule** — within Slack:
   - 9 × `not_in_channel` → `errorKind: "not_in_channel"` (consistent).
   - 7 × `not_in_channel` + 2 × `invalid_auth` → `errorKind: "mixed"`, `detail` matches `/^\d+ sources failed/`.
   - 7 × `ok_empty` + 2 × `not_in_channel` (no ok_data) → `errorKind: "not_in_channel"`, `failedCount: 2`.
9. `summarizeSources` formats the telemetry log line in a stable format (snapshot test).

### `src/components/__tests__/RunOverlay.test.tsx`

Render each outcome:

1. `outcome.kind === "empty"` → title `"Quiet week."`, all rows `✓`, `[Try 30 days]` button present, stage checklist NOT in DOM.
2. `outcome.kind === "partial_failure"` (slack only broken) → title `"Couldn't reach your Slack."`, slack row `⚠`, others `✓`, both `[Fix in Settings]` and `[Try 30 days]` present.
3. `outcome.kind === "partial_failure"` (slack + jira broken) → title `"Couldn't reach 2 of your sources."`.
4. `outcome.kind === "total_failure"` → title `"Keepr couldn't reach any sources."`, all rows `✗`, NO `[Try N days]` button.
5. `[Try N days]` boundary — at `windowDays: 45` button reads `"Try 90 days"`. At `windowDays: 90` button is disabled with tooltip.
6. `onTryLongerWindow` callback fires with the next-doubled-days on click.
7. `onFixInSettings` callback fires with `focusKind: "slack"` when partial_failure has exactly one broken kind, no kind otherwise.
8. Legacy `stage: "error"` thrown-error path still renders today's "Something went sideways." (the `no-sources-configured` case from the previous PR — confirms no regression there).

### `src/components/onboarding/__tests__/StepSlack.test.tsx` — extension

9. Step 05 copy is present in the rendered numbered list — assert exact substring `"/invite @Keepr"`. Catches accidental deletion.

### Manual verification (real Tauri shell)

- Fresh install, Slack token configured but no `/invite` done → run pulse → **State B** expected. Title says "Couldn't reach your Slack." Slack row has `⚠` + invite copy. Others show `✓` with empty-state copy. Confirm `Sessions` sidebar shows a `complete` row (not `failed`).
- Invite the bot to all channels (or run on a workspace with activity) → re-run → **ready**.
- Yank network → run pulse → **State C**. Title says "couldn't reach any sources." Every row `✗`. Confirm sidebar shows a `failed` row with the new error message.
- Configure all integrations, pick sources on a team that was genuinely quiet (use a 1-day window) → **State A**. Title says "Quiet week." `[ Try 30 days ]` primary. **Confirm sidebar shows NO new row** (empty was deleted).
- `[ Try 30 days ]` click → fresh run with `daysBack = 28`. Confirm a NEW session row is created (D4 — not updating the original).
- `[ Fix in Settings ]` from State B with only Slack broken → lands in Settings scrolled to Slack panel.
- Run twice from `Run first pulse` button rapidly → second run aborts the first (existing behavior preserved).
- Cancel mid-run after some fetches succeeded → overlay clears, no outcome shown (existing abort).

## Deferred (TODOs)

| Decision | If deferred | Recommended owner |
|----------|-------------|-------------------|
| `conversations.join` auto-join for Slack channels (requires `channels:join` manifest scope) | Users keep doing the `/invite` step manually. Fine for v1; revisit if telemetry shows >30% of Slack users hit `not_in_channel` post-onboarding. | Follow-up plan. |
| Historical "active N days ago" hint on empty state | Users who land on State A don't know if it's a quiet week or a silent config issue. Mitigation: the per-source checks already prove the fetchers ran. | Backlog. |
| Help-doc link from the Slack `invite @Keepr` warning | Users who don't know what `/invite` means have to Google it. Acceptable gap — most Slack users know. | Backlog. |
| `danger` color token for State C × + warnings | v1 uses `text-ink-soft` across all non-success rows. Works, but reads less urgent than a proper red would. Gate on DESIGN.md extraction. | Follow-up. |
| Retry-the-same-window button | Skipped by design — if it just ran and got nothing, retry won't help. Revisit only if users request. | Skip. |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 11 issues (6 arch + 4 quality + 0 perf), 1 P0 critical gap (token leak in unknown-error copy → fixed via scrubber), 4 decisions resolved (D1 lifecycle, D2 aggregation, D3 raw copy, D4 new-session-per-retry), regression test added (abort mid-flight), 9 file lanes mapped. |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | INLINE | Scoped to the RunOverlay error screen only; three-state model + per-source row agreed with the user before plan drafted. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 0
**VERDICT:** DESIGN + ENG CLEARED — ready to implement.
