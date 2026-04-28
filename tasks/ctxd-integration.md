# ctxd as Keepr's Default Memory Store

**Target releases:** v0.2.6 (foundation + visible wins), v0.3.0 (graph + dedup + external MCP), v0.4 (pipeline swap + bulk markdown import).

**Status:** plan locked, awaiting answers on three open questions before first PR (see end).

---

## Decisions locked

1. **ctxd is `keeprlabs/ctxd`** — Rust, Apache-2.0, single binary, MCP-native, SQLite/FTS5/HNSW under the hood, GitHub + Gmail adapters already shipped upstream.
2. **Tauri sidecar binary**, not linked crate. Lifecycle managed in `src-tauri/src/memory/daemon.rs`. Bound to loopback only.
3. **Two SQLite files.** `keepr.db` keeps mutable operational state (sessions, secrets, followups, fetch_cache). `ctxd.db` is the append-only memory log. Linked via `source_uri` on `evidence_items`.
4. **Side-by-side, no markdown migration in v0.2.6.** Forward-only writes. Markdown stays canonical. GitHub history is **re-ingested** by `ctxd-adapter-github` (not migrated). Bulk markdown → ctxd import lands in v0.4 once the schema is proven.
5. **`pipeline.ts` stays on the markdown tail in v0.2.6.** The prompt-builder swap to `ctx_search` lands in v0.4 alongside markdown bulk import — when ctxd has real content. v0.2.6 ships UI value, not prompt changes.
6. **Embedder = `null` (FTS-only) by default.** Ollama / OpenAI opt-in lands in v0.3.0. BM25 over names, repo IDs, and ticket IDs covers ~80% of real queries.
7. **Rust backend brokers all ctxd calls.** Frontend never touches ctxd directly. Capability tokens, ports, and error normalization live in Rust. Mirrors the `secrets.rs` pattern.
8. **MCP is the LLM exposure surface.** Internal: `pipeline.ts` calls ctxd directly via the Tauri broker (no MCP roundtrip — it's the same process boundary). External: opt-in toggle lands in v0.3.0 with biscuit-scoped read-only access.
9. **No "ctxd" string in the UI.** It's substrate. Settings labels say "Memory."

---

## Architecture

### Sidecar lifecycle

```
src-tauri/src/memory/
  mod.rs              — Tauri commands (memory_*)
  daemon.rs           — sidecar spawn, health probe, restart, shutdown
  client.rs           — wraps ctxd-client (Rust SDK), owns capability
  ingest.rs           — orchestrates adapter binaries (ctxd-adapter-github)
  subjects.rs         — canonical Keepr subject paths (single source of truth)
```

**Boot.** Tauri `setup` hook spawns the sidecar via `tauri-plugin-shell`:

```
ctxd serve \
  --bind 127.0.0.1:<random-port-from-app_config> \
  --wire-bind 127.0.0.1:<random-port+1> \
  --mcp-stdio \
  --storage sqlite \
  --storage-uri <appdata>/keepr/ctxd.db \
  --embedder null \
  --require-auth
```

Random ports per user, persisted in `app_config` at first launch (avoids collision when multiple Keepr windows run, avoids the well-known-port surface). Bind to loopback only — never expose externally.

**Health.** Poll `GET /health` until 200 or 5s elapse. Splash screen waits.

**Shutdown.** `on_window_event(CloseRequested)` sends SIGTERM. ctxd flushes and exits.

**Crash recovery.** If health probe fails mid-session, restart once with exponential backoff. Two consecutive failures surface a banner ("Memory layer offline — using last-known context") and `pipeline.ts` falls back to the v0.2.5 markdown path. Never fully broken.

**Upgrade.** New Keepr release ships a new ctxd binary. First post-upgrade launch runs `ctxd migrate --db <path>` before `serve`.

**Bundle.** ctxd binary stripped is ~15-25 MB per platform. Vendored into `src-tauri/binaries/ctxd-{target-triple}` and wired via `tauri.conf.json` `bundle.externalBin`. Same notarization pass as the main binary in `scripts/release.ts`.

### IPC

Frontend never touches ctxd directly. Path:

```
React component
  → invoke('memory_query', ...)         // Tauri
    → src-tauri/src/memory/mod.rs       // Tauri command handler
      → ctxd-client (Rust SDK)          // HTTP to 127.0.0.1:<port>
        → ctxd daemon                   // SQLite
```

Exposed Tauri commands (v0.2.6):

| Command | Purpose |
|---|---|
| `memory_query(q, filters, top_k)` | Hybrid search via `ctx_search` |
| `memory_read(subject, recursive)` | Read events under a subject |
| `memory_write(subject, type, data)` | Write an event |
| `memory_subjects(prefix, recursive)` | List subjects |
| `memory_related(subject)` | Entity neighborhood via `ctx_related` |
| `memory_subscribe(prefix)` | Returns a channel ID; events stream via Tauri events |
| `memory_status()` | Daemon health + counts |

### Subject schema

This is a **public contract.** Once events ship under these paths, renaming means rewriting history. ADR before code (see "Pre-work" below).

| Concept | Subject path | Event types |
|---|---|---|
| Team member | `/keepr/people/{id}` | `person.created`, `person.updated`, `person.fact` |
| Session | `/keepr/sessions/{yyyy-mm-dd}/{workflow}/{slug}` | `session.started`, `session.completed`, `session.failed` |
| Topic | `/keepr/topics/{topic-slug}` | `topic.note`, `topic.updated` |
| Follow-up | `/keepr/followups/{id}` | `followup.opened`, `followup.carried`, `followup.resolved` |
| Status snapshot | `/keepr/status` | `status.updated` |
| GitHub evidence | `/work/github/{owner}/{repo}/pulls/{n}` | adapter-owned (`pr.opened`, `pr.merged`, `pr.review`, ...) |
| Slack/Jira/Linear/GitLab | `/keepr/evidence/{source}/...` | `evidence.recorded` (until upstream adapters land) |

**Cross-cutting views come free** via `ctx_search` filters and `ctx_related`:
- "Priya's PRs" → `ctx_search` with `actor=priya-id` + subject prefix `/work/github/**`
- "This week's sessions" → `memory_read --subject /keepr/sessions/2026-04 --recursive`
- "What's tied to PR #142" → `memory_related --subject /work/github/acme/web/pulls/142`

### GitHub adapter wiring

ctxd ships `ctxd-adapter-github`. We don't write a GitHub adapter; we configure and run it.

1. **Credential handoff.** PAT lives in `secrets` table (`secrets.rs`, key `github_pat`). On ingest, `src-tauri/src/memory/ingest.rs` reads PAT, spawns `ctxd-adapter-github run --db <ctxd.db> --repo owner/name ...` with the token passed as `GITHUB_TOKEN` env var (never command-line — `ps` would expose it).
2. **Repo set.** Derived from `team_members.github_handle` plus `repos_of_interest` in `app_config` (already exists from v0.2.5). One `--repo owner/name` per repo.
3. **Cadence.** On-demand before a session run (synchronous wait, ~5-30s). Background nightly run if app is open. Adapter has its own state DB with cursors and ETags — deltas are cheap.
4. **Idempotency.** Adapter-owned. Stable IDs derived from `(subject, type, source_resource_id)`. Re-run is no-op for unchanged resources.
5. **Subject namespace.** `/work/github/{owner}/{repo}/pulls/{n}` — adapter-defined, we don't override.

For sources without upstream adapters (Slack, Jira, Linear, GitLab), keep existing TS fetchers in `src/services/{slack,jira,linear,gitlab}.ts` and write events via `memory_write` into `/keepr/evidence/{source}/...`. Lightweight bridge until we contribute upstream.

### Two-database link

`evidence_items` rows gain a `subject_path` column (migration #9):

```sql
ALTER TABLE evidence_items ADD COLUMN subject_path TEXT;
CREATE INDEX idx_evidence_subject ON evidence_items(subject_path);
```

UI clicks an evidence row → reads `subject_path` → calls `memory_read(subject_path)` → renders ctxd event detail. This is the bridge that powers the "related panel" (UI feature 4).

---

## v0.2.6 — three weeks, twelve PRs

Sized S (1-2d), M (3-5d). Two engineers parallel after foundation.

### Week 1 — foundation

**PR 1 — `feat/ctxd-bundle` (S→M, 3 days)** — *blocks everything else*

Vendor prebuilt `ctxd` binary per platform into `src-tauri/binaries/`. Wire `tauri.conf.json` `externalBin`. Add `daemon.rs` with spawn / health / restart / shutdown. App-launch splash waits on `/health`. Pin ctxd version via build script.

**PR 2 — `feat/memory-commands-skeleton` (S, 2 days)**

Tauri commands `memory_query`, `memory_read`, `memory_write`, `memory_subjects`, `memory_status`, `memory_related`, `memory_subscribe`, wrapping `ctxd-client` Rust SDK. Capability minted at startup, never persisted. Returns shaped errors normalized for the frontend.

### Week 2 — substrate writes + first UI features

**PR 3 — `feat/memory-subjects` (M, 4 days)** — *needs PR 2*

`subjects.rs` defines canonical paths. `pipeline.ts` dual-writes new sessions, person facts, topic notes, follow-ups: markdown (canonical, unchanged) **and** ctxd event. Behind `app_config.memory.dualWrite` (default true). `evidence_items` gains `subject_path` column via migration #9.

**PR 4 — `feat/memory-github-adapter` (M, 4 days)** — *parallel with PR 3, needs PR 2*

Spawn `ctxd-adapter-github` with PAT from `secrets`. Background re-ingest on first launch with non-blocking banner. Adapter-binary version pinned in build. Dedupe against existing `evidence_items` by `(source_resource_id)` so we don't double-write.

**PR 5 — `feat/cmdk-palette` (S, 2 days)** — *needs PR 2*

Global `cmd+k` overlay. `MemoryPalette.tsx`. Types into `memory_query`. Keyboard-navigates. Enter jumps to source. Frames the rest of the app — three later PRs reuse this overlay component.

**PR 6 — `feat/memory-search` (M, 4 days)** — *needs PR 2*

`src/screens/MemorySearch.tsx` — full-results screen with filter chips (source / person / date). Home search box on `Home.tsx` upgrades from list-filter to `memory_query` + "see all results" link to MemorySearch.

### Week 3 — visible wins + ship

**PR 7 — `feat/person-page-ctxd` (M, 4 days)** — *needs PR 3 (so person facts dual-write) + PR 4 (so GitHub events exist)*

`Person.tsx` reader swaps from markdown tail to `memory_read --subject /keepr/people/{id} --recursive` plus `memory_query` filtered by `actor=<id>` over `/work/github/**`. Real chronological timeline. Person-facts panel keeps reading from markdown (still canonical).

**PR 8 — `feat/related-panel` (S, 2 days)** — *needs PR 2 + 4*

Side panel that opens when an evidence row or PR is selected. Calls `memory_related(subject)` and renders the entity neighborhood. Empty state for items with no relationships — that's fine.

**PR 9 — `feat/activity-sidebar` (M, 4 days)** — *needs PR 2 + 4*

Collapsible right-edge panel. `memory_subscribe('/work/**')` and `/keepr/**`. Renders new events as a feed. **Default-collapsed.** Opt-in to expand.

**PR 10 — `feat/pulse-citations` (S, 2 days)** — *needs PR 3 (so subject_path is populated)*

Pulse renderer adds citation chips. Click → opens the related-panel from PR 8 to that subject. No prompt changes — just rendering links to evidence subjects.

**PR 11 — `feat/onboarding-reingest-banner` (S, 2 days)** — *needs PR 4*

First-launch banner: "Memory is rebuilding from your GitHub history. Search results will fill in over the next ~10 minutes." Dismissible. Status from `memory_status`. Default-on for re-ingest.

**PR 12 — Polish, eval pass, release**

Eval set comparison: pulse quality unchanged vs v0.2.5 (we didn't swap pipeline.ts — should be identical). Memory-related crash rate measurement. CHANGES.md, version bump, ship.

### Critical path

```
PR 1 ──▶ PR 2 ──┬──▶ PR 3 ──┬──▶ PR 7
                 │           ├──▶ PR 10
                 │           └──▶ PR 11
                 ├──▶ PR 4 ──┬──▶ PR 7
                 │           ├──▶ PR 8
                 │           └──▶ PR 9
                 ├──▶ PR 5
                 └──▶ PR 6
```

Two engineers can run weeks 2-3 in parallel: one on PR 3 → 7 → 10, the other on PR 4 → 8 → 9. PRs 5, 6, 11 fit between.

### v0.2.6 ships with

- ctxd daemon as substrate, invisible to users.
- Forward-only writes to ctxd from session boundaries.
- GitHub history re-ingested into `/work/github/**`.
- `cmd+k` palette, MemorySearch screen, person page on ctxd, related panel, activity sidebar, pulse citations.
- `app_config.memory.dualWrite=true` default, kill switch present.
- `pipeline.ts` unchanged (still markdown tail) — pulse quality identical to v0.2.5.

---

## v0.3.0 — graph + dedup + external MCP

Roughly 4 weeks after v0.2.6.

1. **`feat/memory-graph`** — `ThreadGraph.tsx` upgrade using `ctx_related`, `ctx_entities`. Cross-source neighborhoods (PR ↔ ticket ↔ person ↔ session).
2. **`feat/memory-decay-dedup`** — re-ranker wrapping `ctx_search` (`final = rrf * exp(-Δdays/60)`). Weekly consolidation pass writes `topic.consolidated` events with `supersedes: [...]` field. Materialized views ignore superseded events. Memory health Settings page.
3. **`feat/memory-mcp-external`** — Settings toggle "Allow external AI tools to read your Keepr memory." Mints biscuit capability scoped read-only to `/keepr/**` + `/work/**`. Surfaces Claude Desktop config text to copy. HTTP/SSE bind on a separate loopback port behind bearer-token auth. Audit log into a new `external_mcp_log` table. Writes from external tools blocked by `HumanApprovalRequired` caveat — rendered as in-app approval prompts.
4. **`feat/memory-embedder-opt-in`** — Settings → "Better search (slower setup)" → detect Ollama at `127.0.0.1:11434` (auto-fill `nomic-embed-text`) or paste OpenAI key. Restart daemon with `--embedder ollama|openai`. Backfill embeddings via `ctxd embed-backfill` on existing log. No re-ingest.

---

## v0.4 — markdown bulk import + pipeline swap

Roughly 4 weeks after v0.3.0.

1. **`feat/memory-markdown-import`** — walk `memoryDir` markdown + historical `evidence_items` rows, write events. Idempotent. Resumable. Non-lossy (markdown unchanged). Triggered from Settings → "Import history" with a progress bar. Estimated ~10-30 min for heavy users.
2. **`feat/pipeline-ctxd-retrieval`** — `pipeline.ts` `readMemoryContext` swaps from "tail last 6KB" to a `memory_query` shaped for the session's framing question + recent person/topic events. Behind `app_config.memory.useCtxdRetrieval` flag. A/B against v0.2.5 path on the eval set. **This is the one that finally fixes pulse recency bias.**
3. **`feat/memory-share-capability` (stretch)** — UI to mint scoped biscuits for sharing a person page or session with another user. Generates a temporary HTTP endpoint or signed export. Probably slips to v0.5.
4. **`feat/memory-federation` (stretch)** — peer two Keepr instances over LAN/WAN. "Sync your Keepr memory between laptops." Optional, hidden behind a Settings toggle. Probably slips to v0.5.

---

## Pre-work before PR 1 (this week)

Three artifacts gate the first PR. None are code.

### ADR-001 — ctxd subject schema (this is the one-way door)

Document at `docs/decisions/001-ctxd-subject-schema.md`:
- Person ID type (open question 1)
- Path patterns for all Keepr concepts
- Versioning strategy (`schema_version` field on events?)
- What's adapter-owned vs Keepr-owned
- Naming conventions (slug case, date format)

### ADR-002 — ctxd lifecycle and ports

Document at `docs/decisions/002-ctxd-lifecycle.md`:
- Sidecar boot + shutdown semantics
- Random-port-per-user policy
- Restart-on-crash policy (max 2)
- Fallback path when daemon is down

### Build infra task

Decide how `ctxd` binary gets into `src-tauri/binaries/`. Options:
- Vendor binaries committed to repo (large but simple)
- Build in CI via a separate workflow that pulls upstream tags
- Pull from a GitHub Release artifact at Tauri build time

Recommendation: build in CI. Eliminates large committed binaries, guarantees reproducibility.

---

## Risks and kill criteria

### Risks

1. **Sidecar lifecycle in production.** Zombie processes after force-quit, port collisions, signing drift. *Mitigation:* random ports persisted in `app_config`, PID file at `<appdata>/keepr/ctxd.pid`, kill-stale on startup, ctxd included in same notarization pass.
2. **Adapter binary version drift.** ctxd's GitHub adapter is a separate binary. Schema skew if user upgrades ctxd separately. *Mitigation:* pin both binaries to exact versions in our build, don't expose ctxd path to users.
3. **Subject schema lock-in.** Once events are written, renaming the scheme means rewriting history. *Mitigation:* ADR-001 before PR 1; treat as public contract; `schema_version` on events.
4. **GitHub re-ingest on first launch is slow for heavy users.** 10-30 min in background. *Mitigation:* progress banner; results in Memory Search arrive incrementally; user can dismiss banner and keep working.
5. **Bundle size growth.** ctxd binary adds ~15-25 MB per platform. *Mitigation:* monitor DMG size in CI, alert if total grows past 80 MB net add.

### Kill criteria (review at week 6 post-v0.2.6)

If any **two** hit, flip `app_config.memory.dualWrite=false` for everyone via remote config and ship v0.2.7 with rollback:

- ctxd daemon crash rate > 0.5% of sessions.
- p95 `memory_query` latency > 600 ms on a 50k-event store.
- Memory-related Tauri command error rate > 1% of invocations.
- Bundle size DMG net add > 80 MB.
- User reports of lost data (any number > 0 — markdown is canonical so this should be impossible, but verify).

A `app_config.memory.remoteKillSwitch` flag must exist from v0.2.6 day 1.

---

## Resolved questions (locked 2026-04-28)

1. **Person subject IDs — UUID.** Path is `/keepr/people/{uuid}`. Display name written as `person.created` event field; rename writes a `person.updated` event without changing the subject. `team_members` table gains a `ctxd_uuid` column (migration #10) populated lazily on first event write per person. Slug stays for human-readable URLs in the UI, resolved via `team_members.slug → ctxd_uuid` lookup.

2. **GitHub re-ingest default — on, with dismissible banner.** Background ingest starts on first v0.2.6 launch. Banner reads "Memory is rebuilding from your GitHub history. Search results will fill in over the next ~10 minutes." Dismissible. Status from `memory_status`. Settings → Memory → "Pause re-ingest" if a user wants to halt mid-flight.

3. **Federation — deferred to v0.5+.** Not surfaced in v0.2.6, v0.3.0, or v0.4. ctxd's federation primitives (peer, replicate, biscuit handoff) stay internal substrate. Revisit when the rest of the integration is proven.

---

## What this plan saves vs. the original migration-first design

- **One M-sized PR cut** (`feat/memory-migrate` removed from v0.2.6, deferred to v0.4).
- **~3-5 days of engineering** in v0.2.6.
- **A class of "import lost X" bugs** that would require markdown-walking edge-case code.
- **Schema-rewrite risk** — by v0.4 we'll have lived with the schema in production for two releases.
- **Decision-making weight** — we get to learn from real ctxd usage data before deciding what's worth importing. Some markdown sessions older than 90 days may never get queried, in which case we never bother importing them.
