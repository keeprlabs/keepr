<p align="center">
  <img src="public/wordmark.png" width="154" alt="Keepr" />
</p>

<p align="center">
  <strong>The local-first AI memory layer for engineering leaders.</strong><br/>
  Turn Slack and GitHub exhaust into cited weekly briefs and 1:1 prep — on your laptop. No backend, no account, no telemetry.
</p>

<p align="center">
  <a href="https://github.com/keeprlabs/keepr/stargazers"><img src="https://img.shields.io/github/stars/keeprlabs/keepr?style=flat&color=yellow" alt="GitHub stars" /></a>
  <a href="https://github.com/keeprlabs/keepr/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://github.com/keeprlabs/keepr/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/keeprlabs/keepr/ci.yml?branch=main&label=CI" alt="Build Status" /></a>
  <a href="https://github.com/keeprlabs/keepr/releases/latest"><img src="https://img.shields.io/github/v/release/keeprlabs/keepr?include_prereleases&label=release" alt="Release" /></a>
  <a href="https://github.com/keeprlabs/keepr/releases"><img src="https://img.shields.io/badge/platform-macOS-lightgrey" alt="Platform: macOS" /></a>
</p>

<p align="center">
  <a href="docs/screenshots/demo.gif">Demo</a> ·
  <a href="./plugin/">Claude Code Plugin</a> ·
  <a href="./PRIVACY.md">Privacy</a> ·
  <a href="./ROADMAP.md">Roadmap</a> ·
  <a href="https://github.com/keeprlabs/keepr/releases/latest">Latest Release</a>
</p>

---

<p align="center">
  <img src="docs/screenshots/demo.gif" width="720" alt="Keepr demo" />
</p>

## Features

| | Feature | Description |
|---|---|---|
| 🧠 | **Team pulse** | Monday-morning read of what happened across your team last week, evidence-backed and cited |
| 🤝 | **1:1 prep** | Context for an upcoming 1:1 — recent work, open threads, follow-up items |
| 📋 | **Engineering update** | Stakeholder-ready: shipped, in progress, blocked, upcoming |
| 📊 | **Performance evaluation** | Evidence-organized eval with optional rubric mapping |
| 🚀 | **Promo readiness** | Gap analysis against target level with cited evidence |
| 🕸️ | **Evidence graph** | Force-directed view of how evidence connects across sources — zoom, pan, drag, click |
| 🗓️ | **Team heatmap** | Activity grid by member and day, configurable 7/14/28-day range |
| ✅ | **Follow-up tracker** | Kanban for action items extracted from briefs (open / carried / resolved) |
| 🔗 | **Citation sync** | Click any citation to see source evidence — bidirectional highlighting |
| 🛡️ | **Confidence indicators** | Per-section badges based on evidence depth and source diversity |
| 📝 | **Local memory** | Observed facts as plain markdown — open in Obsidian, grep, or commit privately |
| 🔎 | **Memory search** | Full-text search across sessions, people, topics, and evidence (v0.2.7+) |
| 🪶 | **Related-memory panel** | Click any citation or evidence row to see the entity neighborhood (v0.2.7+) |
| 📡 | **Activity sidebar** | Live feed of memory-layer events, default-collapsed (v0.2.7 stub; v0.4 streams) |
| ⌨️ | **Keyboard-first** | Command palette (Cmd+K), citation scroll, session history |
| 🚫 | **Zero telemetry** | Nothing phones home. Keepr cannot see your sessions. |

## Quick Start

```bash
brew install --cask keeprlabs/tap/keepr
```

Open the app, walk through onboarding (LLM provider → Slack → GitHub → team → memory directory → privacy ack), then press **Cmd+K** and run `team pulse`.

### Develop locally

You need **Node 20+**, **Rust (stable)**, and **npm**.

```bash
# 1. Clone and install
git clone https://github.com/keeprlabs/keepr.git && cd keepr && npm install

# 2. Run the desktop app with HMR
npx tauri dev

# 3. Press Cmd+K and run a session
```

Build a standalone debug binary: `npx tauri build --debug --no-bundle && ./src-tauri/target/debug/keepr`.

## Use Keepr from Claude Code

Keepr ships a [Claude Code plugin](./plugin/) for capturing follow-ups, checking status, and triggering pulses without leaving your terminal.

```bash
/plugin marketplace add keeprlabs/keepr
/plugin install keepr@keeprlabs-keepr
```

Available skills: `/keepr:keepr-add-followup`, `/keepr:keepr-status`, `/keepr:keepr-open`, `/keepr:keepr-pulse`. Skills also activate contextually — mention wanting to track something for a 1:1 and Claude will suggest adding a follow-up. See [`plugin/README.md`](./plugin/README.md).

## Architecture

```
fetch  ->  prune  ->  Haiku map  ->  Sonnet reduce  ->  write memory
```

| Layer | Technology |
|---|---|
| Desktop shell | [Tauri 2](https://v2.tauri.app/) (Rust) |
| Frontend | React 19, TypeScript, Tailwind CSS |
| Database | SQLite via `tauri-plugin-sql` |
| Secrets | macOS Keychain via `keyring` crate |
| LLM providers | Anthropic, OpenAI, OpenRouter, any OpenAI-compatible endpoint |
| Data sources | Slack, GitHub, Jira, Linear |
| Build | Vite, Cargo |

- **`src-tauri/`** — Rust shell. SQLite bridge, OS keychain, atomic file I/O with lock. No OAuth callback server, no background workers.
- **`src/services/`** — TypeScript business logic. DB, secrets, sources, providers, map/reduce pipeline, memory layer.
- **`src/prompts/`** — Prompt templates as plain markdown imported via `?raw`. Tune by editing the file and reloading.
- **`src/components/` and `src/screens/`** — React 19 UI. Command-palette-first navigation, keyboard shortcuts, bidirectional citation scrolling.
- **`~/Documents/Keepr/`** — Canonical memory. Plain markdown files you can open in Obsidian, grep, or commit to a private repo. Keepr's SQLite is metadata; the memory itself is files on disk.

Evidence items get stable `ev_N` IDs. The LLM cites by ID only; the app resolves IDs to URLs at render time. Memory files persist observed facts only — interpretations live in the session file for that run and never get appended to memory.

## Privacy Posture

The honest version:

- **Keepr operates no servers.** No backend, no analytics, no telemetry. Keepr cannot see your sessions.
- **Your data still leaves your laptop in two specific ways:**
  1. To Slack and GitHub (and optionally Jira/Linear) — the original sources. You already trust them with this data.
  2. To whichever LLM provider you configured. Raw Slack content and PR descriptions flow into their API for synthesis. This is the main remaining trust surface.
- **What local-first buys you:** no middleman vendor pools your team's data with other customers'. Two parties see your content instead of three.
- **What it does not buy you:** it does not eliminate the LLM provider from your trust model. If your company forbids sending Slack messages to Anthropic or OpenAI, Keepr cannot help you today.

Read [`PRIVACY.md`](./PRIVACY.md) before connecting a real work Slack.

## Contributing

Dogfood-first project. Use the app on real data for at least one session before proposing prompt or pipeline changes.

1. **Fork** and clone your fork
2. **Branch** from `main` — `git checkout -b feat/your-change`
3. **Test** locally — `npm test && npx tauri dev`
4. **PR** against `main` with a clear description; screenshots for UI changes
5. **Response within 48 hours** on weekdays

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Security issues: see [`SECURITY.md`](./SECURITY.md).

## Roadmap

v0.1.x shipped the foundation: five workflows, four data sources, local memory, demo mode. v0.2.0 added evidence auditability (cards, confidence, timeline, heatmap, graph) and the follow-up tracker. v0.2.1 added the CLI and Claude Code plugin. v0.2.5 reworked onboarding with org-scoped GitHub teammate search. v0.2.6 shipped closed-loop auto-update via the Tauri v2 updater. v0.2.7 (next) brings ctxd as the default memory store: Cmd+K finds anything across history, evidence rows pivot into the related-memory panel, and a quiet activity sidebar previews the live feed landing in v0.4. See [`ROADMAP.md`](./ROADMAP.md) and [`tasks/ctxd-integration.md`](./tasks/ctxd-integration.md) for what's next.

## License

MIT © Keepr Labs. See [`LICENSE`](./LICENSE).

## Star History

<a href="https://star-history.com/#keeprlabs/keepr&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=keeprlabs/keepr&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=keeprlabs/keepr&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=keeprlabs/keepr&type=Date" />
  </picture>
</a>

---

<p align="center">
  Built with Tauri, React, and TypeScript
</p>
