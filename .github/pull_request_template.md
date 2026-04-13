## Description

<!-- What problem does this solve? Be specific about the user problem, not just the code change. -->

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Prompt change (tuning or rewriting a prompt template)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)

## Related Issues

Fixes #

## How you tested on real data

<!-- Keepr is built dogfood-first. Describe which workflow you ran, on what data, and what the output looked like. "I ran the tests" is not sufficient for prompt or pipeline changes. -->

## What you checked did not change

<!-- For prompt changes: paste a before/after diff of at least one session output. For pipeline changes: confirm which workflows you re-ran. -->

## Checklist

- [ ] I have used Keepr on real data for at least one session
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vite build` succeeds
- [ ] `cargo check --locked` in `src-tauri/` succeeds
- [ ] No new dependencies without justification below
- [ ] I have updated documentation if applicable

## New dependencies (if any)

<!-- Justify each new dependency. The dependency graph is small on purpose. -->

## Screenshots (if applicable)

<!-- UI changes: include before and after screenshots. -->
