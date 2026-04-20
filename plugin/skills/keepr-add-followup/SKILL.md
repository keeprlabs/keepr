---
name: keepr-add-followup
description: "Capture a follow-up item in Keepr. Use when the user mentions wanting to remember something for a later 1:1, surface a topic in their next team conversation, track a commitment they made to a team member, or note something to check on later."
---

# Add Follow-up

Create a follow-up item in Keepr's follow-up tracker. The item is stored as a markdown file in the memory directory and appears in the Keepr desktop app's follow-up board.

## Steps

### 1. Check if keepr is installed

```bash
which keepr 2>/dev/null
```

If this fails, invoke the `/keepr:keepr-setup` skill first, then return here.

### 2. Extract the follow-up

From the user's message, extract:
- **text**: The full follow-up description. Keep the user's own words — don't rephrase.
- **subject** (optional): If the follow-up is clearly about a specific person, extract their name for the `--subject` flag. This helps Keepr associate the follow-up with a team member.

### 3. Create the follow-up

**With a subject (person-specific):**
```bash
keepr cli add-followup "Check on Alice's PR for the auth migration — she mentioned being blocked on API team review" --subject "Alice"
```

**Without a subject (general):**
```bash
keepr cli add-followup "Revisit the on-call rotation schedule before next sprint planning"
```

The command prints the file path of the created follow-up on success.

### 4. Confirm

Tell the user the follow-up was saved. Mention they can view and manage all follow-ups in the Keepr app via `Cmd+K → Follow-ups` or the sidebar.

### 5. Check for updates (background)

```bash
keepr cli check-update 2>/dev/null
```

If an update is available, mention it briefly at the end.
