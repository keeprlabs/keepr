# Contributing

Thank you for your interest in contributing to Keepr. Please review our [Code of Conduct](./CODE_OF_CONDUCT.md) before participating.

Keepr is built dogfood-first. That shapes how contributions work.

## The rule that matters most

**Use the app on real data for at least one session before proposing a change.** Not a test workspace. Not a synthetic fixture. Your actual Slack, your actual team, your actual Monday morning. If you haven't done that, we cannot tell whether your idea is right, and you cannot either.

This applies to everyone, including the founder. It is the reason v1 is as narrow as it is.

## Development setup

```bash
npm install
npx tauri dev
```

You need Node 20+, Rust stable, and a working Xcode command line toolchain on macOS. Everything else is handled by npm and cargo.

Most real logic lives in TypeScript under `src/services/` and `src/prompts/`. The Rust side (`src-tauri/`) is a thin shell — SQLite, keychain, atomic file I/O. You probably don't need to touch it.

## Tuning prompts

Prompts are the product. They live as plain markdown under `src/prompts/`:

- `team-pulse.md` — the Sonnet reduce prompt for team pulse
- `one-on-one-prep.md` — the Sonnet reduce prompt for 1:1 prep
- `channel-summary.md` — the Haiku per-channel map prompt

To tune a prompt:

1. Run the app with `npx tauri dev`
2. Generate a session against real data
3. Edit the markdown file in place — Vite HMR picks it up
4. Re-run the session and diff the output against the previous one
5. Keep a note of what you changed and why

**Two hard rules on prompt changes:**

- **Facts vs interpretations.** The `## Memory deltas` section must contain observed facts only, prefixed with `{person_id: tm_N}`. Do not let the LLM smuggle interpretations into memory. If your prompt change makes the model editorialize in that section, back it out.
- **Citation discipline.** The model cites evidence by `ev_N` id and nothing else. Do not let it hallucinate URLs, names, or timestamps. If a prompt change produces a single uncited claim that looks like a citation, back it out.

A prompt change is ready to PR when you've seen it produce better output on at least two real sessions on two different days. One run is not enough.

## Filing issues

Good issues look like this:

1. **What you ran.** Workflow name, repos selected, Slack channels selected, approximate date range.
2. **What you expected.** One sentence.
3. **What happened instead.** Paste the relevant section of the generated markdown. Redact names if you need to.
4. **The evidence ids the model cited or failed to cite.** `ev_12`, `ev_34`. If it made an unsupported claim, say which claim.
5. **Screenshots** of anything UI-related.

Bug reports without reproducible evidence get closed with a request for more detail. This is not gatekeeping — it's that prompt quality issues are impossible to triage from vibes.

**False claims are P0.** A single fabricated blocker or invented morale read is worse than fifty edits on otherwise factual output. If you catch a false claim, open an issue tagged `false-claim` with the exact sentence and the evidence that should have prevented it.

## Code style

- TypeScript strict mode. `npx tsc --noEmit` must pass.
- `npx vite build` must succeed.
- `cargo check` in `src-tauri/` must succeed.
- Prefer explicit over clever. Future-you at 2am during an incident will thank you.
- No new dependencies without justification in the PR description. The dependency graph is small on purpose.
- Comments explain "why". Code explains "what".

## Pull requests

- Branch off `main`.
- One logical change per PR.
- In the description: what problem you're solving, how you tested it on real data, and what you checked that did not change.
- CI runs `tsc --noEmit`, `vite build`, and `cargo check`. Green CI is required.
- A reviewer will ask "what user problem does this solve?" and "what's the simplest version that would work?". Have answers ready.

## Things we will not merge

- New data sources beyond Slack and GitHub until v2
- Anything that introduces a backend Keepr operates
- Telemetry in v1 (planned for v1.5, opt-in, aggregate only)
- Features that only make sense for a hypothetical future user
- Dependencies with a single maintainer and no release in the last 12 months, absent a specific reason

## Security vulnerabilities

If you find a security issue, do not open a public issue. See [`SECURITY.md`](./SECURITY.md) for how to report it.

## License

By contributing to Keepr, you agree that your contributions will be licensed under the MIT License.
