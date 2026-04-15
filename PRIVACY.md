# Privacy

This is the honest version. Read it before you point Keepr at a real work Slack.

## What Keepr is

Keepr is a desktop application. It runs on your laptop. There is no Keepr backend, no Keepr database, no Keepr account, no Keepr analytics pipeline. Keepr cannot see your sessions, cannot count your runs, and cannot recover your data if you delete it.

## Where your data actually goes

Your data does leave your laptop. Anyone who tells you otherwise about an LLM-powered tool is lying to you. Here is exactly where it goes:

1. **To Slack and GitHub.** Keepr calls Slack's Web API and GitHub's REST API using the credentials you provided. Those are the original sources of the data. You already trust Slack and GitHub with it.
2. **To whichever LLM provider you configured.** When Keepr runs a team pulse or a 1:1 prep, raw Slack message content and PR descriptions are sent to your chosen provider's API (Anthropic, OpenAI, or OpenRouter) for synthesis. This is the main remaining trust surface and it is not eliminated by running the app locally.

That's it. Two destinations. No third party.

## What local-first actually buys you

- **No middleman vendor holds your data.** Cloud competitors like Bond, Jellyfish, and Entelligence ingest your Slack and GitHub history into their infrastructure. Keepr does not.
- **One fewer party in the trust chain.** The number of organizations who see your content is two (Slack/GitHub plus your LLM provider) instead of three.
- **No data pooling.** Your team's messages are never aggregated with any other customer's data. There is no shared database.
- **No SaaS breach exposure.** There is no Keepr database for an attacker to compromise.

## What local-first does not buy you

- **It does not remove the LLM provider from your trust model.** If your company policy forbids sending Slack messages to Anthropic or OpenAI, Keepr cannot help you in v1. Read your own acceptable-use policy first.
- **It does not redact PII.** Raw message content, including names and anything people typed in channel, flows to the LLM provider. v1 has no redaction layer.
- **It does not encrypt your data at rest beyond what macOS already does.** The SQLite file and the memory markdown files sit in your home directory. If someone has your unlocked laptop, they can read them.

## What Keepr stores locally

- **SQLite** at `~/Library/Application Support/keepr/` (or the macOS equivalent). Metadata: session history, team member mappings, which repos and channels you selected.
- **Memory files** in the directory you picked during onboarding (default `~/Documents/Keepr/`). Plain markdown: `status.md`, `memory.md`, `people/*.md`, `sessions/*.md`. You can open these in Obsidian, grep them, or put them in a private git repo.
- **Secrets** — API keys, Slack bot token, GitHub PAT — in the macOS Keychain. Not in SQLite, not in any config file.

## Data sources in v1

- **Public Slack channels only.** You pick up to 10. No DMs. No private channels. This keeps the Slack app out of the sensitive-scopes review tier and out of places you probably do not want an LLM reading.
- **GitHub PRs and reviews** for the repos you selected. No secrets scanning, no private issue bodies beyond what comes back from the PR endpoints.

## Retention

Everything persists locally until you delete it. There is no auto-purge. Keepr does not "forget" things.

- **Delete a session:** remove the file from `sessions/` in your memory directory.
- **Delete all data:** remove the memory directory and uninstall the app. The SQLite file and the Keychain entries go with the uninstall.

There is no remote data for Keepr to delete on your behalf, because there is no remote data.

## Telemetry

**None in v1.** Not even anonymous usage counts. Not a crash reporter. Nothing.

When telemetry is added in v1.5, it will be opt-in, off by default, and strictly aggregate: workflow name, duration, success or failure. Never content. Never IDs that identify you or your team.

## LLM provider specifics

Keepr sends the same payload to whichever provider you picked: pruned evidence JSON and the prompt template. Each provider has its own data policy. Read it.

- **Anthropic** — commercial API inputs are not used for model training by default. See Anthropic's usage policy.
- **OpenAI** — API inputs are not used for training by default. See OpenAI's data usage policy.
- **OpenRouter** — routes your request to the underlying provider. Data handling depends on which model you pick.

If your employer has a relationship with one of these providers (e.g. a zero-retention addendum), configure Keepr to use that provider.

## Questions

File an issue tagged `privacy`. If it's sensitive, reach out to the maintainers (contact on the landing page).
