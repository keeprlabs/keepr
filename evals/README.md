# Keepr prompt eval harness

A deliberately minimal harness for manually diffing prompt changes.
No assertions, no automation, no CI gate. The goal is: a maintainer sits
down, runs a fixture through the real prompt pipeline, reads the output
by eye, and decides whether the prompts are still honest.

## What it does

1. Loads a synthetic "evidence" JSON fixture from `evals/fixtures/`.
   Each fixture is a hand-crafted week of activity for a 5-person team
   (PRs, reviews, Slack messages) with stable `ev_N` ids.
2. Runs the real Keepr prompt contract against it:
   - Per-bucket map step with `src/prompts/haiku_channel_summary.md`
     and the configured classifier model.
   - Final reduce step with `src/prompts/team_pulse.md` or
     `src/prompts/one_on_one_prep.md` and the configured synthesis
     model.
3. Writes the final markdown to
   `evals/out/{fixture}-{workflow}-{timestamp}.md` alongside the
   per-bucket Haiku summaries, for manual inspection.

The harness uses the same prompt files and the same evidence JSON
shape as `src/services/pipeline.ts` — it just does not touch the DB,
the Tauri plugins, or the memory file writer. It talks to Anthropic
directly over plain `fetch`.

## Running it

```sh
export ANTHROPIC_API_KEY=sk-ant-...

# Team pulse on the baseline fixture:
npm run eval -- team_pulse baseline

# 1:1 prep for tm_3 on the stretched-thin fixture:
npm run eval -- one_on_one_prep stretched_thin --target tm_3

# List available fixtures:
npm run eval -- --list
```

Optional flags:

- `--synthesis-model <id>` (default `claude-sonnet-4-5`)
- `--classifier-model <id>` (default `claude-haiku-4-5`)
- `--memory <path>` — point at a file whose contents become the
  `# Memory context` block. Defaults to the literal string
  `first run — no prior context`, which is how the harness validates
  the first-run empty state.

## What to look for when reading the output

This is the manual checklist. The bar is "maintainer edits less than 30%
and zero false claims."

1. **Zero false claims.** Every blocker, win, incident, and "stretched
   thin" bullet must cite at least one `[^ev_N]`. Open the fixture,
   find the cited id, confirm the claim is actually supported.
2. **No invented ids.** Every `[^ev_N]` in the output must exist in
   the fixture. The harness prints a warning if it sees an id it
   cannot resolve.
3. **Memory deltas discipline.** Every bullet under `## Memory deltas`
   must start with `- {person_id: tm_N}`, must be a pure observed
   fact, and must cite `[^ev_N]`. No adjectives about the person. No
   morale reads. The regex in `src/services/memory.ts` (`parseDeltas`)
   is what will actually consume this section in production — if the
   harness shows a delta bullet the regex cannot parse, the model is
   about to poison memory with nothing.
4. **First-run empty state.** The default memory context is
   `first run — no prior context`. The model must not mention the
   absence of memory in the output.
5. **Section order and headings.** Team pulse must have: Blockers,
   Wins, Incidents, People stretched thin, Open questions for the EM,
   Memory deltas. 1:1 prep must have: Wins, Blockers, Questions they
   asked, Coaching moments, Open PRs needing feedback, Memory deltas.

## Fixtures

- `baseline.json` — a quiet-but-healthy week. One shipped feature, a
  couple of reviews, a small incident that resolved cleanly. The
  honest pulse is short. If the model pads it out, that is a failure.
- `stretched_thin.json` — one engineer (tm_3) is clearly carrying an
  outsized load: authored 3 PRs, reviewed 4 others, led an incident
  response, on-call same week. Two independent signals per the
  "People stretched thin" rule, so the model SHOULD flag this.
- `ambiguous.json` — deliberately ambiguous signals: one PR has been
  open 5 days but has comments on it; one engineer asked two questions
  about a topic but also shipped a PR on it. The model should resist
  the temptation to read morale into this.

## What this harness is NOT

- Not a regression test. No golden outputs. LLM outputs are
  non-deterministic and diffing full markdown is noisy.
- Not a metric. No "accuracy" number. The only metric is the maintainer's
  eyes on the output.
- Not wired to the Tauri runtime. It imports no Tauri plugins and
  cannot see your real memory files, DB, or secrets. It reads
  `ANTHROPIC_API_KEY` from env.
- Not a substitute for running the real app against your real team
  data before shipping a prompt change.
