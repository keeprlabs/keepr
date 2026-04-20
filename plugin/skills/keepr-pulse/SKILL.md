---
name: keepr-pulse
description: "Generate a team pulse in Keepr — a summary of what the team accomplished recently. Use when the user wants a quick read of team activity, asks what the team shipped this week, or wants to prepare for a team standup or all-hands. The result is viewable in the Keepr desktop app."
---

# Team Pulse

Trigger a team pulse generation in Keepr. The pulse fetches recent activity from Slack, GitHub, Jira, and Linear, then synthesizes a cited brief.

The data pipeline requires the full desktop app runtime (API calls, LLM synthesis, memory writes), so this skill opens the app and guides the user.

## Steps

### 1. Check if keepr is installed

```bash
which keepr 2>/dev/null
```

If this fails, invoke the `/keepr:keepr-setup` skill first, then return here.

### 2. Launch the pulse

```bash
keepr cli pulse
```

This opens the Keepr desktop app and prints instructions.

### 3. Guide the user

Tell the user:

> Keepr is opening. To generate the team pulse:
> 1. Press **Cmd+K** in the app
> 2. Type **"team pulse"** and hit Enter
> 3. The pulse takes about 60 seconds to generate
>
> Once complete, you can view the evidence-backed brief in the app.

### 4. Check for updates (background)

```bash
keepr cli check-update 2>/dev/null
```

If an update is available, mention it briefly.
