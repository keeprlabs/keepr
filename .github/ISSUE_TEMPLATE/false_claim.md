---
name: False claim
about: Report a fabricated or unsupported claim in Keepr's output
title: "[FALSE CLAIM] "
labels: ["false-claim", "P0"]
assignees: ""
---

## The false claim

Paste the exact sentence from the generated output that is false or unsupported.

## Why it's false

Explain what the evidence actually says vs. what the model claimed. Include the `ev_N` IDs that should have prevented this claim, or note that no evidence supports it at all.

## Workflow and context

- **Workflow:** (e.g. team pulse, 1:1 prep)
- **LLM provider:** (e.g. Anthropic, OpenAI)
- **Approximate data volume:** (e.g. 5 channels, 3 repos, 7-day window)

## Session file

If possible, attach or paste the relevant sections of the session markdown file from your memory directory (`sessions/*.md`). Redact names if needed.

## Additional context

Anything else that might help reproduce the issue.

**A single fabricated blocker or invented morale read is worse than fifty edits on otherwise factual output. These are always P0.**
