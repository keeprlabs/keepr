# Roadmap

Keepr ships in stages. Each stage unlocks the next; nothing past v0.2.x is promised, and scope gets decided from evidence, not intuition.

## v0.2.1 — shipped

Claude Code plugin and CLI surface.

- **CLI subcommands** — `keepr cli status`, `open`, `add-followup`, `pulse`, `check-update`
- **Claude Code plugin** — five skills for follow-ups, status, team pulse from the terminal
- **Homebrew cask** — `brew install --cask keeprhq/tap/keepr` with auto-update on release
- **Update notifications** — desktop banner + CLI check + plugin hints

## v0.2.0 — shipped

Evidence auditability and daily loop features.

- **Evidence cards** — rich popovers on citation hover/click with source-specific metadata
- **Citation scroll sync** — slide-out evidence panel with bidirectional highlighting
- **Confidence indicators** — green/amber/red per-section badges with LLM signal
- **Timeline strip** — activity sparkline with colored source markers
- **Follow-up tracker** — markdown-backed Kanban with auto-creation from sessions
- **Team heatmap** — member × day activity grid with evidence drill-down
- **Evidence graph** — SVG relationship visualization between evidence items

## v0.1.x — shipped

The foundation. macOS desktop app, five workflows, four data sources, local memory.

- **Team pulse** — Monday-morning read of what happened across your team last week. Evidence-backed, cited, written to `sessions/` as markdown.
- **1:1 prep** — Context for an upcoming 1:1 with recent work, open threads, follow-up items.
- **Weekly engineering update** — Stakeholder-ready summary: shipped, in progress, blocked, upcoming.
- **Performance evaluation** — Evidence-organized eval with optional rubric mapping. 6-month default time range.
- **Promo readiness** — Gap analysis against target level with cited evidence.
- **Slack integration** — Public channels (up to 10), bot token auth.
- **GitHub integration** — PRs and reviews for selected repos, PAT auth.
- **Jira integration** — Issues, comments, sprint data for selected projects. Basic auth.
- **Linear integration** — Issues, comments, project updates for selected teams. API key auth.
- **Local memory** — `status.md`, `memory.md`, `people/*.md`, `topics/*.md` persisted on disk. Observed facts only.
- **Topics auto-creation** — Recurring themes extracted from sessions, accumulated in `topics/` files.
- **Demo mode** — Synthetic 5-person team with sample data across all sources. Try before connecting real accounts.
- **Onboarding** — 7-step real flow, 3-step demo flow. LLM provider, Slack, GitHub, Jira, Linear, team members, memory directory, privacy consent.
- **Keyboard-first UI** — Command palette (Cmd+K), citation scroll, session history, sidebar navigation.
- **Multi-provider LLM** — Anthropic, OpenAI, OpenRouter, custom OpenAI-compatible endpoints, Claude Code CLI.
- **Signed .dmg** on GitHub Releases with Apple notarization.
- **Zero telemetry** — Nothing phones home.

## Next — planned, not promised

- **Dark mode**
- **Windows + Linux builds**
- **Auto-update** via the Tauri updater
- **Calendar integration** for automatic 1:1 time-range detection
- **Cross-platform identity reconciliation** — no more manual display name → GitHub handle → Slack user ID mapping
- **Slack bot interface** as an alternate surface for workflows
- **Google Doc / Notion export** for sessions

## Explicitly not on the roadmap

These are things people will ask for that Keepr is deliberately not going to do:

- Multi-tenant orgs, team-level billing, SSO, audit logs
- A hosted SaaS version of the desktop app (a separate product motion, not a version of this one)
- Private Slack channels and DMs (sensitive scopes, Slack review tier)
- PII redaction before sending to the LLM provider — the user picks a provider they already trust
- Team-wide DORA dashboards, peer calibration, engineering metrics reporting
- Mobile app
- A vector store, RAG pipeline, or memory graph beyond the files-on-disk layer
- Any feature that requires Keepr to operate a server

## How scope gets decided

Every scope decision is made from evidence, not intuition. A feature lands on the roadmap only after at least one real user has asked for it, or after dogfood has surfaced a specific missing capability that blocks weekly use. If you think something belongs on the roadmap, open an issue with the story of how you'd use it.
