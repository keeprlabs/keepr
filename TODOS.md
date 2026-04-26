# TODOS

Deferred work captured during plan reviews. Each entry has full context so a future
contributor (or future-you) can pick it up cold.

---

## Refactor Settings.tsx Jira and Linear panels to use useScopePicker

**What:** Refactor `src/screens/Settings.tsx` Jira and Linear panels to consume the `useScopePicker` hook (introduced in `tasks/onboarding-scope-picker.md`).

**Why:** When `tasks/onboarding-scope-picker.md` landed, the Slack and GitHub panels in Settings were migrated to share `useScopePicker` with onboarding. Jira and Linear panels were intentionally left as-is to keep the diff bounded. The inconsistency will rot quietly if not addressed.

**Pros:**
- One source of truth across all 4 integrations in both onboarding and Settings.
- Bug fixes in `useScopePicker` (stale-diff, race fix, search) automatically benefit Jira/Linear.
- ~50 lines of duplicated chip-toggle code disappear from Settings.tsx.

**Cons:**
- ~50-line diff that's unrelated to any user-facing feature.
- Adds 2 more test cases per integration (Jira, Linear) to `useScopePicker.test.ts`.

**Context:** After the onboarding-scope-picker plan ships, `useScopePicker('slack')` and `useScopePicker('github')` are battle-tested in two places (onboarding step + Settings panel). The same pattern applies to Jira and Linear with no architectural risk. Look at how the Slack/GitHub Settings panels were converted as the template; the lister adapters in `useScopePicker` already cover all four integrations.

**Depends on / blocked by:** `tasks/onboarding-scope-picker.md` landing first.

---

## Real Slack-activity ranking for smart defaults

**What:** Replace the v1 member-count proxy with real "most active in last 7 days" ranking for Slack channels in `useScopePicker`.

**Why:** Member-count is a weak signal — `#random` and `#announcements` (already excluded by name) are usually the biggest. For workspaces with mostly-equal channel sizes, recommendations are random. Real activity ranking would meaningfully improve the "5-second visceral" moment in onboarding.

**Pros:**
- Smart defaults actually feel smart.
- Higher likelihood the user accepts defaults without tweaking.

**Cons:**
- Requires N `conversations.history` calls (one per channel, `oldest=now-7d, limit=1`). With 200 channels and concurrency=5, that's ~10s of extra fetch on first-load.
- Needs a loading-with-shimmer UX or a background refetch pattern (designed in the original plan as "option C", deferred).

**Context:** The v1 plan (`tasks/onboarding-scope-picker.md`) explicitly chose member-count to ship fast. Telemetry on smart-default acceptance rate would tell us if this matters. If acceptance is >70%, this stays a low-priority TODO; if <50%, raise priority.

**Depends on / blocked by:** Telemetry on smart-default acceptance rate (which doesn't exist yet — see "Add onboarding telemetry" if/when that's logged).

---

## Extract DESIGN.md from globals.css + primitives.tsx

**What:** Codify the de-facto Keepr design system in a `DESIGN.md` at repo root.

**Why:** No DESIGN.md exists today. The vocabulary (off-white canvas, ink palette, hairline borders, Newsreader serif headings, mono uppercase labels with 0.14em tracking) lives implicitly in `src/styles/globals.css` tokens and `src/components/onboarding/primitives.tsx`. Future contributors (or AI coding tools) drift without an explicit reference.

**Pros:**
- One reference for "what does Keepr look like".
- Prevents the chip pattern from being reimplemented with subtle differences.
- Required input for `/plan-design-review` and `/design-review` to do their best work.

**Cons:**
- Maintenance: if the design changes, the doc must follow. Stale docs are worse than no docs.

**Context:** Flagged during `/plan-design-review` of the onboarding-scope-picker plan. The new `<SourceChip>`, `<ChipGrid>`, `<FilterInput>`, `<ScopeSection>` primitives establish part of the vocabulary; the rest exists in `globals.css` (color tokens, spacing scale, font choices) and the existing onboarding/primitives.tsx (Title, Lede, Field, etc.).

**Depends on / blocked by:** Nothing. Pre-req before any third-party contributor lands UI work.

---

## Just-in-time picker fallback at first-pulse trigger

**What:** When a user clicks Run Pulse and `pipeline.ts` finds zero configured sources, instead of throwing an error, show a sheet/modal with the same `useScopePicker` UX inline. They pick, click "Start", pulse runs.

**Why:** The onboarding-scope-picker plan covers users who flow through onboarding normally. But users who deliberately Skip-for-now ALL integrations, or who lose their selections somehow, hit a thrown error. A just-in-time picker would catch them gracefully.

**Pros:**
- Removes the last "wall" the user can hit.
- Reuses `useScopePicker` — no new abstraction.

**Cons:**
- Only matters if telemetry shows the skip-all path is real (probably <5% of users).
- Adds a modal layer to `RunOverlay` which is currently a single-purpose surface.

**Context:** This was the "option B" alternative in the original brainstorm. The team chose "option A: inline scope in onboarding" instead. If telemetry shows the soft-error from the improved pipeline copy is hit by >20% of users, raise priority on this.

**Depends on / blocked by:** `tasks/onboarding-scope-picker.md` landing + telemetry on first-pulse error rate.

---

## Auto-page Slack channels beyond 2000

**What:** Either bump `listPublicChannels()` page cap above 10 (= 2000 channels), or surface a warning when the cursor is exhausted at the cap.

**Why:** Big enterprises can have 5000+ public Slack channels. Today `slack.ts:48` silently caps at 2000. The user's channel might not be in the list and they'd never know.

**Pros:**
- Correctness for large workspaces.
- Search would actually reach all channels.

**Cons:**
- More API calls on initial load (rate-limit consideration).
- Memory: 5000 channel objects ~= 1MB, not nothing.

**Context:** Discovered during `/plan-eng-review` of the onboarding-scope-picker plan. The 2000-channel cap is a Slack rate-limit pragmatism. For v1, the soft cap is acceptable — most users have <500 public channels. Add a console warning when cursor is hit AND last page was full.

**Depends on / blocked by:** Nothing.

---

## Create DESIGN.md

**What:** Write a single-page DESIGN.md at the repo root capturing Keepr's visual vocabulary — color tokens (ink, ink-soft, ink-faint, sunken, hairline, accent), typography stack, spacing scale, common component patterns (Panel, Field, sunken card, chip, eyebrow), motion durations, and the "why" behind each choice.

**Why:** No design system doc exists today. Every design review re-derives the vocabulary from the Tailwind config and the existing components. Discovered during `/plan-design-review` of `tasks/codex-provider.md` — the "category divider" decision had to reach into `Settings.tsx:170` to find the eyebrow pattern that already exists.

**Pros:**
- Future design reviews calibrate against a stated system instead of re-discovering it.
- New contributors (human or AI) pattern-match faster.
- Forces us to notice when one screen invents new tokens that should be promoted.

**Cons:**
- Half-day write + ongoing maintenance.
- Risk of doc drift if not updated when the system evolves.

**Context:** Worth doing once we have 2-3 more design reviews to draw from (so the doc captures real patterns, not a guess at them). Keep it short — a 3-page reference, not a 30-page brand book.

**Depends on / blocked by:** Nothing. Can ship anytime.

---

## Split self_hosted as a third visible category in the LLM picker

**What:** When the second self-hosted provider lands (Qwen Local, Ollama, etc.), flip Custom's `category` from `hosted` to `self_hosted` and add a third `<CategoryDivider label="Self-hosted" />` between the CLI and self-hosted groups in StepLLM and Settings.

**Why:** `tasks/codex-provider.md` introduced the categorized picker with three categories defined (`hosted`, `cli`, `self_hosted`) but only renders two visible sections to avoid an awkward single-card "Self-hosted" group containing only Custom. The third section auto-renders when its category becomes non-empty, but the trigger to flip Custom's category is a manual decision.

**Pros:**
- Better mental model — Custom (point at any OpenAI-compatible endpoint) is conceptually self-hosted, not hosted.
- The data-layer plumbing already exists; this is a one-character change once the second provider arrives.

**Cons:**
- Has to be remembered when adding the next self-hosted provider.

**Context:** See `tasks/codex-provider.md` "Provider categorization (data layer)" section. The `providersByCategory()` helper iterates over all three categories in fixed order; empty categories don't render their divider.

**Depends on / blocked by:** Adding a second self-hosted provider (Qwen Local or similar).
