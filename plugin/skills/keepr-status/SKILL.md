---
name: keepr-status
description: "Check Keepr configuration and connection status. Use when troubleshooting Keepr, before running other Keepr commands, or when the user asks about their Keepr setup."
---

# Keepr Status

Show the current Keepr configuration: LLM provider, connected data sources, memory directory, team member count, last session, and open follow-ups.

## Steps

### 1. Check if keepr is installed

```bash
which keepr 2>/dev/null
```

If this fails, invoke the `/keepr:keepr-setup` skill first, then return here.

### 2. Check for updates

```bash
keepr cli check-update
```

If an update is available, mention it to the user but continue with the status check.

### 3. Show status

```bash
keepr cli status
```

Present the output to the user. If any sources show "none connected", suggest opening Settings to connect them.
