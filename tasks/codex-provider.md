# Codex CLI as an LLM provider + provider-picker restructure

Add `codex` (OpenAI's Codex CLI) to Keepr's LLM provider picker, AND restructure
the picker into a categorized layout that scales to 10+ providers (Qwen and
others coming next).

## Why

Two reasons stacked:

1. Engineering leaders who use Codex CLI as their daily AI tool want the same
   "no separate key — just billing through my existing account" path Claude
   Code users get. Today they either set up a separate OpenAI API key (billing
   duplication) or skip Keepr.
2. The current 5-card flat grid breaks at ~8-10 providers, and we know more are
   coming (Qwen Cloud, Qwen Local, others). Adding Codex into the flat grid
   means designing into a layout we'll redo within a quarter. Cheaper to
   restructure once and add Codex as the first beneficiary.

## Picker layout (decided)

**X2: thin dividers + small-caps labels.** The cards keep their current size
and 2-line blurbs (no teaching copy lost). Each category transition costs
~30-40px of vertical space — a single horizontal rule with a small-caps label
floated over it. New vocabulary = one CSS rule.

```
┌────────────┐ ┌────────────┐
│ Anthropic ★│ │ OpenAI     │      HOSTED — bring your own key
│ Sonnet/Hku │ │ gpt-4o/min │      (Anthropic, OpenAI, OpenRouter, Custom,
└────────────┘ └────────────┘       and future cloud providers like Qwen)
┌────────────┐ ┌────────────┐
│ OpenRouter │ │ Custom     │
│ Any model  │ │ OpenAI-cmp │
└────────────┘ └────────────┘
  ─────  L O C A L   C L I  ─────
┌────────────┐ ┌────────────┐
│ Claude Code│ │ Codex      │      LOCAL CLI — no key needed
│ No API key │ │ No API key │      (Claude Code, Codex, future CLI tools)
└────────────┘ └────────────┘
```

*(Self-hosted is folded into HOSTED-Custom for now since "Custom" is one card;
when we add Qwen Local or Ollama as a first-class card, split it out as a third
section.)*

**Category divider styling:** reuse the existing eyebrow treatment from
`Settings.tsx:170` (`text-[11px] uppercase tracking-[0.18em] text-ink-faint`).
The horizontal rule is a 1px solid hairline (`border-hairline`), label sits
inline-centered with a 16px gap from the rules on each side. Do NOT use
dashed borders or all-caps headers — both are generic SaaS patterns that
break the existing visual vocabulary.

Same treatment in Settings: today's flat button row gets the same two thin
dividers between the same groups, no other layout change.

## Provider categorization (data layer)

Store the category on the provider definition itself, not in the consumer.

```ts
export type LLMCategory = "hosted" | "cli" | "self_hosted";

export interface LLMProvider {
  id: LLMProviderId;
  category: LLMCategory;          // NEW
  label: string;
  // ... existing fields
}
```

Consumers (StepLLM, Settings) get a single helper:

```ts
export function providersByCategory(): Record<LLMCategory, LLMProvider[]>;
```

UI iterates over `["hosted", "cli", "self_hosted"]` in fixed order and
renders `<CategoryDivider label="..." />` between groups. Adding a new
provider = one new entry in `PROVIDERS`, no UI changes.

Empty categories don't render their divider — relevant today because
`self_hosted` only contains `custom`, which v1 keeps grouped under
hosted. When Qwen Local lands, flipping its category to `self_hosted`
auto-renders the third section.

## Scope

Eight places need touching. Listed in dependency order.

### 1. Type extensions

- `src/lib/types.ts`: add `"codex"` to the `Provider` union and to
  `AppConfig.llm_provider`.
- `src/services/llm.ts`: add `"codex"` to `LLMProviderId`.
- `src/services/secrets.ts`: add `codex: "llm.codex.key"` to `SECRET_KEYS`
  for symmetry, even though no key is stored.

### 1.5. Tauri shell capability

- `src-tauri/capabilities/default.json`: extend the `shell:allow-execute`
  allowlist (currently `[{ "name": "claude", "cmd": "claude", "args": true }]`)
  with a `codex` entry. Without this, `Command.create("codex", ...)` throws
  a Tauri permission error at runtime — the Rust shell layer denies any
  process not in the allowlist.

```json
{
  "identifier": "shell:allow-execute",
  "allow": [
    { "name": "claude", "cmd": "claude", "args": true },
    { "name": "codex",  "cmd": "codex",  "args": true }
  ]
}
```

### 2. Provider implementation (`src/services/llm.ts`)

A new `codex: LLMProvider` object alongside `claudeCode`:
- `id: "codex"`, `label: "Codex"`, `category: "cli"`, `keyUrl: ""`
- `defaultSynthesisModel`: `"gpt-5"`
- `defaultClassifierModel`: `"gpt-5-mini"`

**Spawn shape (locked-down):**

```ts
const args = [
  "exec",
  "-C", safeCwd,              // hermetic cwd (tempdir)
  "-s", "read-only",          // sandbox: no file writes
  "--skip-git-repo-check",    // tempdir isn't a git repo; codex would refuse otherwise
  "--ephemeral",              // don't persist a rollout file in ~/.codex/sessions/
  "--json",                   // newline-delimited event stream (gives token usage)
  "--output-last-message", outFile,
  "-m", opts.model,
  "--",                       // separator so a prompt starting with `-` isn't parsed as a flag
  prompt,
];
```

`-s read-only` enforces no file writes by the agent. `codex exec` is
non-interactive by definition (no `--ask-for-approval` flag exists on the
subcommand — verified against codex CLI v0.125.0; we omit it deliberately,
and the spawn-flags test asserts it stays absent as a regression guard).
`--skip-git-repo-check` is mandatory because our hermetic tempdir isn't a
git repo and codex refuses to run outside one by default. `--ephemeral`
keeps `~/.codex/sessions/` clean — every Keepr synthesis would otherwise
leave a rollout file behind.

**Output parsing:**

`codex exec --json` emits NDJSON events on stdout. Parse line-by-line.
The assistant text comes from `--output-last-message` (read after process
exits). Token counts come from the final `TaskComplete` event in the
event stream (or whichever event includes `usage` — verify against codex
v0.x docs at implementation time). On parse failure (codex outputs
something unexpected), fall back to `{ input_tokens: 0, output_tokens: 0 }`
and log a warning to DevTools console.

**Cancellation:**

Use `cmd.spawn()` instead of `cmd.execute()` so we can kill the child
process on signal abort. Wire `opts.signal` to `child.kill()`:

```ts
const cmd = Command.create("codex", args);
const child = await cmd.spawn();
opts.signal?.addEventListener("abort", () => child.kill(), { once: true });
// resolve via cmd.on("close", ...) and stdout/stderr listeners
```

The existing `claudeCode.complete()` at `llm.ts:351` calls `cmd.execute()`
and ignores `opts.signal` — Claude Code sessions are silently uncancellable
today. As part of this PR, refactor claudeCode to the same `spawn()` pattern.
That fixes a latent bug while we're already in this file.

**`test()`:** runs a tiny `codex exec --json` with a one-token prompt
("ok"). Confirms the CLI is installed AND authed in one round-trip.

**Probe cache (shared by onboarding + Settings):**

```ts
type ProbeResult = { ok: true } | { ok: false; reason: "not_installed" | "not_signed_in" | "other"; raw: string };
let _codexProbeCache: ProbeResult | null = null;
export async function probeCodex(force = false): Promise<ProbeResult> { ... }
export function invalidateCodexProbe() { _codexProbeCache = null; }
```

Module-level cache lives until full app reload. Onboarding's "Detect &
save" → `probeCodex(true)` (force re-probe on user click). Settings'
passive status reads cached value first, falls back to `probeCodex()`
only on first read. The "Detect again" button after a failed not-signed-in
state calls `probeCodex(true)` to bypass the cached failure.

**Codex specifics worth noting:**
- Auth lives in `~/.codex/auth.json`, populated by `codex login`
  (interactive browser flow). We can't run that from inside the app — the
  user has to do it in a terminal once.
- No equivalent of the `CLAUDECODE` env var trick — Codex doesn't refuse
  to run when nested.

### 3. Shared primitives

Two new components in `src/components/primitives/` (alongside the existing
primitives there).

**`<CategoryDivider label="Local CLI" />`** — renders a 1px hairline rule
with an inline-centered small-caps label. Reused by StepLLM and Settings.
Styling pinned to the existing eyebrow vocabulary
(`text-[11px] uppercase tracking-[0.18em] text-ink-faint`,
`border-hairline`). `role="separator"` + `aria-label` for screen readers.

**`<CliProviderPanel provider={p} probe={probeResult} onRetry={...} />`** —
single source of truth for rendering the idle/ok/err states of a
CLI-detected provider (claudeCode, codex, future). Replaces the four
near-identical render blocks that would otherwise live in
`StepLLM.tsx` (claudeCode + codex idle copy) and `Settings.tsx`
(claudeCode + codex passive status). Handles:
- Idle copy ("No API key required. Uses your installed X CLI.")
- OK status (`X CLI: detected ✓`, green)
- Not-installed help block (with provider-specific install command)
- Not-signed-in help block with click-to-copy command (provider-specific:
  `claude login` / `codex login`)
- Network/other error (renders `friendlyProviderError(e, provider)`)

The provider object exposes the install + login commands (new
`LLMProvider.cli?: { installCmd?: string; loginCmd?: string; installUrl?: string }`).
That keeps the CLI strings next to the provider definition, not duplicated
in the panel component.

### 4. Onboarding card grid (`src/components/onboarding/StepLLM.tsx`)

Add a `codex` entry to the `PROVIDERS` array AND restructure the renderer
to group by category:

```ts
{ id: "codex", category: "cli", badge: "No API key",
  blurb: "Uses your installed Codex CLI. No separate API key needed." }
```

Render order: iterate `["hosted", "cli", "self_hosted"]`, render each
group's cards in the existing 2-col grid, drop a `<CategoryDivider />`
between non-empty groups. Empty categories don't render their divider —
v1 has no `self_hosted` entries so only one divider appears (between
HOSTED and LOCAL CLI).

When `provider === "codex"`:
- Hide the API key input.
- Show the same "No API key required" sunken panel as Claude Code, with
  Codex-specific copy.
- Button label: "Detect & save" / "Detecting…".

### 5. Settings switcher (`src/screens/Settings.tsx:178`)

Add `"codex"` to the provider list AND apply the same categorized
rendering as onboarding — group the buttons by category with
`<CategoryDivider />` between groups. Six flat buttons in the current row
would give ~80px per button (tight but legible); the categorized layout
sidesteps the question and matches the onboarding mental model.

When `cfg.llm_provider === "codex"`:
- Passive status card: `Codex CLI: detected ✓`. Probed lazily — only
  fires on first activation of the LLM panel by a Codex user. Reads the
  module-level `_codexProbeCache` first (set by onboarding's prior probe),
  so most users never trigger a Settings-side probe at all.
- Users opening Settings to fix Slack/GitHub/Jira do NOT trigger a Codex
  probe (and thus no silent OpenAI billing call).
- If probe fails, render the same inline help + click-to-copy `codex login`
  block as onboarding. "Detect again" button calls `probeCodex(true)` to
  bypass the cached failure.
- The synthesis/classifier model fields below the switcher stay editable so
  power users can switch from `gpt-5` to `o1` etc.
- Loading state: while the lazy probe is in flight (~1-3s round-trip to
  OpenAI), the passive status card shows `Codex CLI: checking…` with the
  same `aria-live="polite"` treatment used in onboarding. Users never see
  a blank/ambiguous status.

### 6. Detection state matrix

`codex --version` succeeds even when the user isn't logged in, so a probe
that only checks the binary will give false confidence. The real probe has
to be a tiny `codex exec` with a one-token prompt. State table for the
Codex card + button + status line in StepLLM:

```
STATE                     | BUTTON       | CARD CONTENT                         | STATUS LINE
--------------------------|--------------|--------------------------------------|------------------------
idle (just picked Codex)  | Detect & save| "No API key required. Codex CLI uses | (empty)
                          |              |  your existing Codex login."         |
testing                   | Detecting…   | (panel unchanged, button disabled)   | (empty)
ok (installed + authed)   | Detect & save| (panel unchanged)                    | "Codex detected." (green)
err: not installed        | Detect & save| + inline help block:                 | "Codex CLI not installed."
                          |              |  "Install with `brew install codex`  |
                          |              |   or see github.com/openai/codex"    |
err: not signed in        | Detect & save| + click-to-copy command:             | "Codex installed but not signed in."
                          |              |  [ codex login  📋 ]                 |
                          |              |  "Run this in a terminal, then       |
                          |              |   click Detect again."               |
err: network/rate-limit   | Detect & save| (panel unchanged)                    | (existing friendlyProviderError)
```

Two design rules baked in:
1. Failure context renders *inside the card* (where the user's eye already
   is), not only in the StatusLine at the bottom.
2. The not-signed-in error includes a click-to-copy `codex login` button —
   highest-leverage UX detail because it removes the "what was that command
   again?" friction point that kills first-time setup.

### 7. Move and extend `friendlyProviderError`

Move `friendlyProviderError` from `StepLLM.tsx:316` to `src/services/llm.ts`
(it belongs with the providers it describes). Add a `provider === "codex"`
branch with the two new failure modes (not-installed, not-signed-in). Keep
the existing network/rate/scope branches as-is — they apply to any
provider.

Bonus consistency fix: Settings's `saveKey()` at `Settings.tsx:212`
currently renders a bare "Failed" toast on error. After the move, wire it
to call `friendlyProviderError(e, provider)` so users see the same useful
error copy in Settings as in onboarding.

### 8. First-run user journey (storyboard)

Three paths to design for. The not-signed-in path is the most common
first-time failure and the one most likely to lose the user.

```
PATH A: HAPPY (CLI installed + already signed in)
  Picks Codex card → reads "No API key required" → clicks Detect →
  sees "Detecting…" for ~1s → "Codex detected." green → Continue enabled.
  Emotional arc: curious → reassured → done.

PATH B: NOT SIGNED IN (most likely first-time failure)
  Picks Codex card → reads "No API key required" → clicks Detect →
  sees "Detecting…" → error appears IN THE CARD with click-to-copy
  `codex login` and one sentence of why. User opens terminal, pastes,
  signs in, returns, clicks Detect again → green.
  Emotional arc: curious → confused (it failed?) → guided (oh, one
  command) → done. The click-to-copy is the moment of relief.

PATH C: NOT INSTALLED
  Picks Codex card → clicks Detect → error block in card with install
  command. User installs (different terminal session), returns, clicks
  Detect → may STILL fail if not signed in (Path B kicks in).
  Emotional arc: curious → "ah, two-step setup" → completes.
  Risk: user closes Keepr because two manual terminal steps feels like
  more friction than just pasting an API key. Mitigation: the card
  copy from idle state should NOT promise "no setup" — say "no API
  key required" only.
```

The current Claude Code copy says "Keepr will use your installed Claude
Code CLI" — implying installed. We should match: "Keepr will use your
installed Codex CLI." — and let the error states handle the not-installed
and not-signed-in cases. Don't promise zero setup in the idle copy.

## Tests

This plan ships with full test coverage. No test is deferred.

### New test files

- **`src/services/__tests__/llm.test.ts`** — covers the new codex provider,
  the refactored claudeCode provider, `probeCodex` cache, `friendlyProviderError`
  (after move), `providersByCategory`. Mocks `@tauri-apps/plugin-shell`'s
  `Command.create` via `vi.mock` so spawn behavior is deterministic.
- **`src/components/primitives/__tests__/CategoryDivider.test.tsx`** —
  render + a11y attributes.
- **`src/components/primitives/__tests__/CliProviderPanel.test.tsx`** —
  five render states (idle/ok/not_installed/not_signed_in/other), click-to-copy
  via mocked `navigator.clipboard.writeText`, retry callback.
- **`src/components/onboarding/__tests__/StepLLM.test.tsx`** —
  categorized grid renders all 6 providers with one divider, picking codex
  shows CliProviderPanel, Detect calls `probeCodex(true)`, picking anthropic
  shows the existing key input (regression).

### Extended test files

- **`src/screens/__tests__/Settings.test.tsx`** — assert no codex probe
  fires when Settings opens with non-codex provider active
  (billing-blast-radius regression test), plus the categorized button row,
  plus `friendlyProviderError` wiring in `saveKey`.

### Critical regression tests (mandatory)

| # | Regression | Why it matters |
|---|------------|----------------|
| 1 | claudeCode.complete() happy path after spawn() refactor | Existing Claude Code users must not break. |
| 2 | claudeCode.complete() honors opts.signal | Latent bug being fixed; needs a test to lock in. |
| 3 | StepLLM pick-anthropic still renders key input | Categorized rendering refactor must not regress. |
| 4 | Settings opens with non-codex active → zero codex spawns | Enforces the billing-blast-radius decision. |
| 5 | friendlyProviderError preserves existing copy after move | Same strings for anthropic/openai/openrouter/custom/claude-code. |

### Manual E2E (one-time, on first PR build)

Launch the dev app, pick Codex in onboarding with codex CLI both
(a) absent and (b) present-but-unsigned, verify the spawn permission in
`src-tauri/capabilities/default.json` allows the call. Document the manual
verification step in the PR description; we don't have an automated Tauri
E2E harness today.

## Accessibility

- Card buttons: keyboard nav via Tab, Enter/Space to select. The current
  `<button>` element handles this; reuse, don't replace with a div.
- Category dividers: `role="separator"` with `aria-label="Local CLI"` so
  screen readers announce the section change without the visual rule.
- Click-to-copy `codex login` button: `aria-label="Copy command: codex
  login"`, focus visible ring matches existing button focus styles.
- Status line state changes (idle → testing → ok/err) need
  `aria-live="polite"` so screen readers announce detection results
  without stealing focus.
- Color: never communicate state by color alone. The "Codex detected"
  green and the error red must each carry text. (Existing pattern
  already does this — keep it.)

## Resolved design decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Picker layout for N providers | Categorized (X2: thin dividers + small-caps labels) |
| 2 | Settings switcher layout | Same categorization as onboarding |
| 3 | Default synthesis model | `gpt-5` |
| 4 | Default classifier model | `gpt-5-mini` |
| 5 | Pre-empt the `codex login` step in idle copy | No — only show inline help after failed detect |
| 6 | Click-to-copy for `codex login` | Yes — in the not-signed-in error state |
| 7 | Settings detection UX | Passive status `Codex CLI: detected ✓` on panel load (not a button) |
| 8 | Category divider styling | Reuse `Settings.tsx:170` eyebrow pattern (`text-[11px] uppercase tracking-[0.18em] text-ink-faint`) |

## Open decisions deferred to implementation

- Exact wording of the not-installed help block. First draft:
  `Install with `brew install codex` or see github.com/openai/codex` —
  refine during implementation against the actual width.
- Whether the passive Settings status auto-reprobes on every panel-load or
  caches for the session. Default to per-session cache (probe once).

## NOT in scope

- Codex non-interactive auth (would need OpenAI to ship a token-paste flow).
- Auto-installing the Codex CLI for the user.
- Codex's tool-use / file-edit modes — we use it strictly for text
  completion.
- A "Codex Pro" upsell or pricing comparison panel.
- Adding Qwen or any other future provider (sequential follow-up; this PR
  ships the structure).
- Splitting `self_hosted` into a visible third section (deferred to TODOS
  until a second self-hosted provider exists).
- Writing DESIGN.md (deferred to TODOS).

## TODOS captured

- TODOS.md → "Create DESIGN.md" (added)
- TODOS.md → "Split self_hosted as a third visible category in the LLM
  picker" (added)
- `CategoryDivider` shared primitive: build now in this PR (not deferred).

## What already exists

- `claudeCode` provider in `src/services/llm.ts:330` — reference
  implementation for the CLI-spawn pattern, JSON output parsing, and
  `Command.create` usage.
- StepLLM card layout, badge styling, and "no key" sunken panel —
  `StepLLM.tsx:42` (PROVIDERS entry) and `StepLLM.tsx:198` (panel).
- Settings switcher pattern — `Settings.tsx:178` (button row) and
  `Settings.tsx:242` (no-key branch).
- `friendlyProviderError` taxonomy — `StepLLM.tsx:316`.
- `SECRET_KEYS` symmetry pattern — Claude Code has an entry at
  `secrets.ts:20` even though it stores nothing.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 7 issues, 0 critical gaps, 5 lanes parallelized |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (PLAN) | score: 6/10 → 8.5/10, 8 decisions made, 2 deferred |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**UNRESOLVED:** 2 design decisions deferred to implementation (exact not-installed help-block wording; the now-resolved Settings probe trigger). 1 accepted failure mode (NDJSON parse failure silently zeros token counts; mitigated by `console.warn`).

**VERDICT:** DESIGN + ENG CLEARED — ready to implement. Five execution lanes identified, three parallelizable.
