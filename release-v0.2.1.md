# Keepr v0.2.1 — Claude Code Plugin

Use Keepr from your terminal. Capture follow-ups, check status, and trigger team pulses without leaving Claude Code.

## Install

```bash
# Desktop app (required)
brew install --cask keeprhq/tap/keepr

# Claude Code plugin
/plugin marketplace add keeprhq/keepr
/plugin install keepr@keeprhq-keepr
```

## What's new

### CLI

The Keepr binary now accepts `keepr cli <command>` subcommands. No Tauri runtime needed — the CLI reads the same database and memory directory as the GUI.

```bash
keepr cli status          # Config summary
keepr cli add-followup "Check on Alice's PR"  # Create a follow-up
keepr cli open            # Launch the app
keepr cli pulse           # Open app to run team pulse
keepr cli check-update    # Check for newer versions
```

### Claude Code Plugin

Five skills that shell out to the local `keepr` binary:

| Skill | What it does |
|-------|-------------|
| `/keepr:keepr-setup` | Install or update Keepr via Homebrew |
| `/keepr:keepr-add-followup` | Capture a follow-up from conversation |
| `/keepr:keepr-status` | Check config and connections |
| `/keepr:keepr-open` | Launch the desktop app |
| `/keepr:keepr-pulse` | Generate a team pulse |

Skills activate contextually — mention wanting to track something for a 1:1 and Claude will suggest adding a follow-up.

### Update notifications

- **Desktop**: Banner on boot when a newer version is available
- **CLI**: `keepr cli check-update` with upgrade instructions
- **Plugin**: Skills mention available updates

### Homebrew

```bash
brew install --cask keeprhq/tap/keepr
brew upgrade --cask keepr
```

The cask installs Keepr.app and symlinks the binary to PATH so the CLI and plugin work.

## Privacy

No new data flows. The plugin shells out to the local binary. Same trust surface as the desktop app. See [PRIVACY.md](./PRIVACY.md).

## Upgrade

```bash
brew upgrade --cask keepr
```
