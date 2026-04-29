# Benchmark results

Criterion outputs from `cargo bench --bench memory_query` in
`src-tauri/`. Tracks the kill-criteria threshold (p95 < 600ms at 50k
events) for the v0.2.7 ctxd memory layer.

```bash
# Quick run (1k + 10k events, ~30s)
(cd src-tauri && cargo bench --bench memory_query)

# Full run (1k + 10k + 50k, ~5min)
(cd src-tauri && KEEPR_BENCH_50K=1 cargo bench --bench memory_query)

# Output:
#   src-tauri/target/criterion/<bench-id>/  — HTML reports per measurement
#   bench-results/memory_query-{date}.csv   — flat CSV for the spreadsheet
```

Why both: criterion's HTML reports are great for one-off investigation;
the flat CSV is what we paste into the kill-criteria tracker each
release.

## Files

- `README.md` — this file
- `*.csv` — gitignored; per-run outputs
- `*.html` — gitignored

Run results are not checked in. If you want to share a result,
screenshot the HTML report or paste the relevant CSV row into the PR.
