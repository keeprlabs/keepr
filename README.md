<p align="center">
  <img src="public/icon-192x192.png" width="80" alt="Keepr icon" />
</p>

# Keepr

Keepr is an AI memory layer for your team that stays local to your machine. It runs locally on your laptop/machine — your data never touches a middleman server.

Point it at your Slack workspace and a handful of GitHub repos, pick an LLM provider, and Keepr turns the week's exhaust into a cited team pulse or 1:1 prep in about a minute. It's a desktop app, not a SaaS. No backend, no account, no analytics.

## Screenshots

The app ships with a Granola-inspired monochromatic light theme. Inter for UI, Newsreader for display headings, JetBrains Mono for code.

- `docs/screenshots/home.png` — command palette and session list
- `docs/screenshots/team-pulse.png` — team pulse output with inline citations
- `docs/screenshots/one-on-one.png` — 1:1 prep with memory context
- `docs/screenshots/onboarding.png` — first-run credential setup

Screenshots live in `docs/screenshots/`. The placeholders will be replaced before the public invite.

## Quickstart

You need Node 20+, Rust (stable), and npm.

```bash
npm install
npx tauri dev
```

That launches the Tauri window with Vite HMR. First run walks you through:

1. Pick an LLM provider (Anthropic, OpenAI, or OpenRouter) and paste an API key
2. Create a Slack app from the provided manifest and paste its bot token
3. Connect GitHub (PAT is fastest; device flow works once you register an OAuth app)
4. Add team members (display name → GitHub handle → Slack user id)
5. Pick a memory directory (defaults to `~/Documents/Keepr`)
6. Read and acknowledge the privacy posture

Then press ⌘K and run `team pulse`, or type a team member's name for 1:1 prep.

To produce a standalone debug binary:

```bash
npx tauri build --debug --no-bundle
./src-tauri/target/debug/keepr
```

## Architecture at a glance

```
fetch  →  prune  →  Haiku map  →  Sonnet reduce  →  write memory
```

- **`src-tauri/`** — thin Rust shell. SQLite bridge (`tauri-plugin-sql`), OS keychain bridge (`secrets.rs`), atomic file I/O with lock (`fs_atomic.rs`). No OAuth callback server, no background workers.
- **`src/services/`** — TypeScript business logic. DB, secrets, GitHub, Slack, LLM providers, the map/reduce pipeline, and the memory layer.
- **`src/prompts/`** — team pulse, 1:1 prep, and Haiku channel-summary prompts as plain markdown files, imported via `?raw`. Tune them by editing the file and reloading.
- **`src/components/` and `src/screens/`** — React 19 UI. Command-palette-first navigation, keyboard shortcuts, bidirectional citation scrolling.
- **`~/Documents/Keepr/`** (or wherever you pointed it) — canonical memory. Plain markdown files you can open in Obsidian, grep, or commit to a private repo. Keepr's own SQLite is metadata only; the memory itself is files on disk.

Evidence items get stable `ev_N` ids. The LLM cites by id only; the app resolves ids to URLs at render time. Memory files persist observed facts only — interpretations live in the session file for that run and never get appended to memory.

See `DESIGN.md` for the full design and `CHANGES.md` for deviations from it.

## Privacy posture

The honest version:

- **Keepr operates no servers.** There is no backend, no analytics, no telemetry. The founder cannot see your sessions.
- **Your data still leaves your laptop in two specific ways:**
  1. To Slack and GitHub — the original sources. You already trust them with this data.
  2. To whichever LLM provider you configured. Raw Slack message content and PR descriptions flow into their API for synthesis. This is the main remaining trust surface.
- **What local-first actually buys you:** no middleman vendor holds your data. The number of parties who see your content is two (Slack/GitHub plus your LLM provider) instead of three. Your team's data is never pooled with other customers'.
- **What it does not buy you:** it does not eliminate the LLM provider from your trust model. If your company forbids sending Slack messages to Anthropic or OpenAI, Keepr cannot help you in v1.

The full version lives in [`PRIVACY.md`](./PRIVACY.md). Read it before you connect a real work Slack.

## Roadmap

v1 is team pulse plus 1:1 prep on macOS. v1.5 brings weekly engineering updates, Windows and Linux, and auto-update. v2 is the rubric-aware performance and promo work. See [`ROADMAP.md`](./ROADMAP.md) for the full picture — v2 features are planned, not promised.

## Contributing

This is a dogfood-first project. Before opening a PR, read [`CONTRIBUTING.md`](./CONTRIBUTING.md). The short version: use the app on real data for at least one session before proposing changes to prompts or pipeline behavior.

## License

MIT. See [`LICENSE`](./LICENSE).
