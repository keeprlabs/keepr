---
description: "Install or update the Keepr desktop app. Runs automatically when other Keepr skills detect that keepr is not installed. Can also be invoked manually to check for updates."
---

# Keepr Setup

This skill ensures the Keepr desktop app is installed and up to date.

## When to use

- Before any other Keepr skill, if `keepr` is not on PATH
- When the user asks to install or update Keepr
- When the user encounters "keepr: command not found" errors

## Steps

### 1. Check if keepr is installed

Run:
```bash
which keepr 2>/dev/null && keepr cli version
```

If this succeeds, Keepr is installed. Skip to step 3 (update check).

If it fails, proceed to step 2.

### 2. Install Keepr

First check if Homebrew is available:
```bash
which brew 2>/dev/null
```

**If Homebrew is available**, install via cask:
```bash
brew install --cask keeprhq/tap/keepr
```

Then verify:
```bash
keepr cli version
```

**If Homebrew is NOT available**, tell the user:

> Keepr installs via Homebrew. Install Homebrew first:
>
> ```
> /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
> ```
>
> Then run:
> ```
> brew install --cask keeprhq/tap/keepr
> ```

Do NOT attempt to download or install the `.dmg` directly. The Homebrew cask handles signing verification, PATH setup, and future updates.

### 3. Check for updates

If keepr is already installed, check for updates:
```bash
keepr cli check-update
```

If an update is available (exit code 1), ask the user if they want to update:
```bash
brew upgrade --cask keepr
```

### 4. Verify

After install or update, confirm everything works:
```bash
keepr cli status
```

If status shows "not configured", tell the user:

> Keepr is installed but not yet configured. Open the app to complete setup:
> ```
> keepr cli open
> ```
> This takes about 5 minutes — you'll connect your LLM provider, Slack, and GitHub.
