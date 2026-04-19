# Keepr v0.2.0 — Auditable AI + Daily Loop

Every claim in a Keepr brief cites evidence via `[^ev_N]` footnotes. v0.2.0 makes that evidence visible, inspectable, and trust-inducing — and adds a daily loop for follow-ups.

## What's new

### Auditable AI

**Evidence cards.** Hover any citation to see the full evidence — PR title, Slack message, Jira status, Linear state. Click to pin. Every source gets a purpose-built card layout.

**Confidence indicators.** Each section heading now shows a green/amber/red dot. Green = well-cited from multiple sources. Red = thin evidence. Low-confidence sections show a warning banner.

**Citation scroll sync.** The evidence panel slides out from the right edge. Hover a claim → the supporting evidence highlights. Hover an evidence card → the citing claims light up. Bidirectional, keyboard-navigable.

**Evidence graph.** See how PRs, Slack threads, Jira tickets, and Linear issues connect. Nodes colored by source, edges inferred by cross-references. No new dependencies — pure SVG.

### Daily Loop

**Follow-up tracker.** Open questions and action items from 1:1 preps are now automatically tracked. Three-column board (Open / Carried / Resolved) with visual urgency for aging items. Stored as markdown files you can grep or commit.

**Team heatmap.** Member × day grid showing who's active where. Click any cell to see the evidence. Configurable 7/14/28 day range.

**Timeline strip.** Activity sparkline above 1:1 preps. Color-coded by source type — blue PRs, purple reviews, amber Slack, teal Jira.

### Infrastructure

- Window defaults to 1440×900
- Feature flags for all 7 features (Settings → Experimental)
- Keyboard shortcuts for everything
- No new external dependencies
- No telemetry changes

## Upgrade

Pull latest and rebuild:
```bash
git pull
npm install
npx tauri dev
```

The SQLite migration (v7) runs automatically on first launch.

## Breaking changes

None. All existing sessions, memory files, and settings are preserved.
