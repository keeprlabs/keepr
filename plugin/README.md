# Keepr Plugin for Claude Code

> **Requires the Keepr desktop app.** Install it first: `brew install --cask keeprhq/tap/keepr`

This plugin lets you trigger Keepr actions directly from Claude Code. Follow-ups, status checks, and team pulses — without leaving your terminal.

## Install

```bash
# 1. Install the desktop app (if you haven't)
brew install --cask keeprhq/tap/keepr

# 2. Add the plugin marketplace and install
/plugin marketplace add keeprhq/keepr
/plugin install keepr@keeprhq-keepr
```

## Skills

| Skill | What it does |
|-------|-------------|
| `/keepr:keepr-setup` | Install or update the Keepr desktop app |
| `/keepr:keepr-add-followup` | Capture a follow-up for a future 1:1 or team conversation |
| `/keepr:keepr-status` | Check your Keepr configuration and connection status |
| `/keepr:keepr-open` | Open the Keepr desktop app |
| `/keepr:keepr-pulse` | Generate a team pulse (opens the app) |

Skills also activate contextually. For example, if you mention wanting to remember something for a 1:1, Claude will suggest adding a follow-up.

## How it works

The plugin shells out to the `keepr` CLI binary on your machine. Every command runs locally — no data is sent anywhere new. The same trust surface as the desktop app applies: your data flows to Slack/GitHub (original sources) and your configured LLM provider. Nothing else.

The plugin itself stores nothing. It reads from and writes to the same SQLite database and memory directory the desktop app uses.

## Update

When a newer version of Keepr is available, the plugin will mention it. To update:

```bash
brew upgrade --cask keepr
```

## Troubleshooting

**"keepr: command not found"**
Run `/keepr:keepr-setup` to install, or manually: `brew install --cask keeprhq/tap/keepr`

**"Keepr database not found"**
Open the desktop app first to complete initial setup: `keepr cli open`

**Skills not appearing**
Reload plugins: `/reload-plugins`

## Privacy

This plugin introduces no new data flows. It shells out to the local `keepr` binary, which reads your local database and writes to your local memory directory. See the [Keepr privacy posture](../PRIVACY.md) for the full picture.

## License

MIT
