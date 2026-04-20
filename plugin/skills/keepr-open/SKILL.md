---
name: keepr-open
description: "Open the Keepr desktop app. Use when the user wants to view sessions, evidence, team heatmap, follow-up tracker, evidence graph, or 1:1 prep visually."
---

# Open Keepr

Launch the Keepr desktop app. Optionally navigate to a specific session or 1:1 prep.

## Steps

### 1. Check if keepr is installed

```bash
which keepr 2>/dev/null
```

If this fails, invoke the `/keepr:keepr-setup` skill first, then return here.

### 2. Launch the app

**Default (latest session):**
```bash
keepr cli open
```

**Open a specific session by ID:**
```bash
keepr cli open --session 42
```

**Hint to open 1:1 prep for a team member:**
```bash
keepr cli open --prep "Alice Smith"
```

### 3. Confirm

Tell the user Keepr is opening. If they asked for a specific view (heatmap, graph, follow-ups), mention they can navigate there via `Cmd+K` in the app.
