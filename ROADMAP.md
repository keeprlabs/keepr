# Roadmap

Keepr ships in stages. Each stage unlocks the next; nothing past v1 is promised, and scope gets decided from evidence, not intuition.

## v1 — shipping now

macOS only. Two workflows, shared pipeline, held tight on purpose.

- **Team pulse.** Monday-morning read of what actually happened across your team last week. Evidence-backed, cited, written to `sessions/` as markdown.
- **1:1 prep.** Context for an upcoming 1:1 — recent work, open threads, things you said you'd follow up on.
- **Local memory.** `status.md`, `memory.md`, `people/*.md` persisted on disk. Observed facts only. Re-read on every run so the tool gets better the more you use it.
- **Onboarding.** LLM provider, Slack bot token, GitHub PAT or device flow, team members, memory directory, privacy consent — under seven minutes.
- **Data sources.** Public Slack channels (the user picks up to 10) and GitHub PRs plus reviews for selected repos.
- **Keyboard-first UI.** Command palette, citation scroll, session history.
- **Unsigned or signed .dmg** on GitHub Releases. Signed + notarized if the Apple Developer cert is ready; unsigned with "right-click → Open" instructions otherwise.

**Definition of done for v1:** maintainer dogfoods for two consecutive weeks on real team data. Zero false claims per session. Under 30% editing before use. Then invite 5–10 friendly EMs.

## v1.5 — after v1 validates

Unlocked once there are 3+ happy active users on macOS and the prompts have stabilized.

- **Weekly engineering update** — the third weekly-cadence workflow. 80% the same prompt as team pulse with a different output template.
- **Windows + Linux builds.**
- **Auto-update** via the Tauri updater, pointed at GitHub Releases.
- **Homebrew cask.** `brew install --cask keepr`.
- **Dark mode.** Light-only in v1 was a taste call; dark mode comes back as a toggle.
- **Pending-conflict banner** for the memory-layer `.pending` files. Today the maintainer sees a `.pending` sibling in Finder and resolves by hand.
- **Opt-in, aggregate-only telemetry.** Workflow name, duration, success or failure. Never content. Off by default.
- **Google Doc / Notion export** for sessions.

## v2 — planned, not promised

v2 is the long-term product target: the defensibility story. It only ships if v1 earns its keep.

- **Performance evaluation** with bring-your-own-rubric. Paste your engineering ladder as markdown; Keepr maps evidence to ladder dimensions with confidence and rationale. No PDF or Google Doc parsing — markdown input only, same as the original inspiration.
- **Promo readiness** built on the same rubric infrastructure.
- **Jira integration** as a third data source alongside Slack and GitHub.
- **Topic auto-creation.** The `topics/` directory becomes a first-class citizen.
- **Slack bot interface** as an alternate surface for the synchronous workflows. Desktop app remains the primary.
- **Calendar integration** for automatic 1:1 time-range detection.
- **Cross-platform identity reconciliation** — no more manual `display name → GitHub handle → Slack user id` mapping.

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

Every scope decision after v1 is made from evidence, not intuition. A feature lands on the v1.5 or v2 list only after at least one real user has asked for it, or after dogfood has surfaced a specific missing capability that blocks weekly use. If you think something belongs on the roadmap, open an issue with the story of how you'd use it.
