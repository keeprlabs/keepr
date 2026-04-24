// useScopePicker — the shared brain behind the inline scope picker that
// appears in StepSlack / StepGitHub / StepJira / StepLinear (and, after the
// Lane C refactor, the Settings panels). One hook, four adapters, one set of
// behaviors. Bug fixed once = bug fixed everywhere.
//
// State machine
// -------------
//
//   ┌──────┐  reload()       ┌─────────┐  fetcher() ok + items.length > 0
//   │ idle │ ──────────────▶ │ loading │ ─────────────────────────────────┐
//   └──────┘                 └─────────┘                                  │
//                                │ │                                      ▼
//          fetcher() ok +        │ │                              ┌──────────────┐
//          items.length === 0  ◀─┘ │                              │   loaded     │
//                  │               │ fetcher() throws             │ {userEdited} │
//                  ▼               ▼                              └──────────────┘
//          ┌───────────┐    ┌──────────────┐                             ▲   │
//          │   empty   │    │    error     │                             │   │
//          └───────────┘    │ {message,    │                             │   │ toggle()
//                           │  isMissing-  │                             │   │
//                           │  Scope}      │                             │   ▼
//                           └──────────────┘                             │ ┌──────────────┐
//                                                                        │ │ loaded       │
//                                                            reTest() ───┘ │ {userEdited: │
//                                                            (diffs        │   true}      │
//                                                            new items;    └──────────────┘
//                                                            stays loaded;
//                                                            staleItems
//                                                            populated)
//
// Race-fix invariant: when reload() finishes and computes smart defaults,
// the call to setConfig({ ... }) MUST complete BEFORE state transitions to
// "loaded". Otherwise a user clicking Continue immediately after the section
// rises in could trigger the pipeline before the picks are persisted.
//
// Toggle persistence: optimistic local update, then setConfig. On throw:
// revert local state, surface inline ink-soft error, auto-clear after 5s.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig } from "../../lib/types";
import { getConfig, setConfig } from "../../services/db";
import { listPublicChannels, type SlackChannel } from "../../services/slack";
import { listUserRepos } from "../../services/github";
import { listProjects, type JiraProjectRemote } from "../../services/jira";
import { listTeams, type LinearTeamRemote } from "../../services/linear";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IntegrationKind = "slack" | "github" | "jira" | "linear";

export type ScopePickerState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; userEdited: boolean }
  | { kind: "empty" }
  | { kind: "error"; message: string; isMissingScope: boolean };

export interface ScopePickerItem {
  /** Stable identity per integration. Slack=channel.id, GitHub=full_name,
   *  Jira=project.key, Linear=team.key. */
  id: string;
  /** What to render in the chip. Slack=#name, GitHub=full_name, Jira/Linear=
   *  "Name (KEY)". */
  label: string;
  /** The original lister item — kept around so toConfigShape can reconstruct
   *  the persisted shape without a second fetch. */
  raw: unknown;
}

export interface UseScopePickerResult {
  state: ScopePickerState;
  items: ScopePickerItem[];
  visibleItems: ScopePickerItem[];
  selected: Set<string>;
  staleItems: ScopePickerItem[];
  filter: string;
  expanded: boolean;
  toggleError: string | null;
  toggle: (id: string) => Promise<void>;
  setFilter: (q: string) => void;
  expandAll: () => void;
  reload: () => Promise<void>;
  reTest: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Adapter table — one place to bind each integration's lister + identity +
// ranking + persistence shape. Adding a fifth integration is one entry.
// ---------------------------------------------------------------------------

interface Adapter {
  fetcher: () => Promise<unknown[]>;
  identity: (item: any) => string;
  label: (item: any) => string;
  /** Higher = more relevant for smart defaults. */
  rank: (item: any, index: number) => number;
  excludeFromDefaults: (item: any) => boolean;
  configKey: keyof AppConfig;
  toConfigShape: (items: ScopePickerItem[]) => AppConfig[keyof AppConfig];
  fromConfigShape: (val: AppConfig[keyof AppConfig]) => Set<string>;
}

const SLACK_DEFAULT_EXCLUDES = new Set(["random", "general", "announcements"]);

const ADAPTERS: Record<IntegrationKind, Adapter> = {
  slack: {
    fetcher: () => listPublicChannels(),
    identity: (c: SlackChannel) => c.id,
    label: (c: SlackChannel) => `#${c.name}`,
    // num_members not in our SlackChannel type but Slack returns it; cast
    // through any so we don't widen the public type just for ranking.
    rank: (c: any) => (c.num_members as number) || 0,
    excludeFromDefaults: (c: SlackChannel) =>
      SLACK_DEFAULT_EXCLUDES.has(c.name),
    configKey: "selected_slack_channels",
    toConfigShape: (items) =>
      items.map((it) => {
        const c = it.raw as SlackChannel;
        return { id: c.id, name: c.name };
      }) as AppConfig["selected_slack_channels"],
    fromConfigShape: (val) =>
      new Set(
        ((val as AppConfig["selected_slack_channels"]) || []).map((c) => c.id)
      ),
  },
  github: {
    fetcher: () => listUserRepos(),
    identity: (r: { full_name: string }) => r.full_name,
    label: (r: { full_name: string }) => r.full_name,
    // listUserRepos already sorts by pushed_at desc; use array index so the
    // first repo (most recently pushed) ranks highest.
    rank: (_r, index) => -index,
    excludeFromDefaults: () => false,
    configKey: "selected_github_repos",
    toConfigShape: (items) =>
      items.map((it) => {
        const r = it.raw as { name: string; owner: { login: string } };
        return { owner: r.owner.login, repo: r.name };
      }) as AppConfig["selected_github_repos"],
    fromConfigShape: (val) =>
      new Set(
        ((val as AppConfig["selected_github_repos"]) || []).map(
          (r) => `${r.owner}/${r.repo}`
        )
      ),
  },
  jira: {
    fetcher: () => listProjects(),
    identity: (p: JiraProjectRemote) => p.key,
    label: (p: JiraProjectRemote) => `${p.name} (${p.key})`,
    // listProjects orders alphabetically by name; use index so earlier
    // projects rank higher (real activity ranking deferred — see plan).
    rank: (_p, index) => -index,
    excludeFromDefaults: () => false,
    configKey: "selected_jira_projects",
    toConfigShape: (items) =>
      items.map((it) => {
        const p = it.raw as JiraProjectRemote;
        return { id: p.id, key: p.key, name: p.name };
      }) as AppConfig["selected_jira_projects"],
    fromConfigShape: (val) =>
      new Set(
        ((val as AppConfig["selected_jira_projects"]) || []).map((p) => p.key)
      ),
  },
  linear: {
    fetcher: () => listTeams(),
    identity: (t: LinearTeamRemote) => t.key,
    label: (t: LinearTeamRemote) => `${t.name} (${t.key})`,
    rank: (_t, index) => -index,
    excludeFromDefaults: () => false,
    configKey: "selected_linear_teams",
    toConfigShape: (items) =>
      items.map((it) => {
        const t = it.raw as LinearTeamRemote;
        return { id: t.id, key: t.key, name: t.name };
      }) as AppConfig["selected_linear_teams"],
    fromConfigShape: (val) =>
      new Set(
        ((val as AppConfig["selected_linear_teams"]) || []).map((t) => t.key)
      ),
  },
};

// ---------------------------------------------------------------------------
// Constants — tuned per the plan's "Smart defaults + search (v1)" section.
// ---------------------------------------------------------------------------

const SMART_DEFAULT_COUNT = 5;
const VISIBLE_TOP_N = 15;
const FILTER_DEBOUNCE_MS = 120;
const TOGGLE_ERROR_TTL_MS = 5000;
const TOGGLE_ERROR_MESSAGE =
  "Couldn't save selection. Try again or restart Keepr.";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useScopePicker(
  integration: IntegrationKind
): UseScopePickerResult {
  const adapter = ADAPTERS[integration];

  const [state, setState] = useState<ScopePickerState>({ kind: "idle" });
  const [items, setItems] = useState<ScopePickerItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [staleItems, setStaleItems] = useState<ScopePickerItem[]>([]);
  const [filter, setFilterState] = useState<string>("");
  const [debouncedFilter, setDebouncedFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<boolean>(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Refs to avoid stale-closure reads inside async callbacks.
  const itemsRef = useRef(items);
  const selectedRef = useRef(selected);
  // Tracks whether the user has ever toggled a chip on this mount. Survives
  // error → reTest → loaded transitions so the count label doesn't misleadingly
  // flip back to "RECOMMENDED" after the user already edited.
  const userEditedRef = useRef(false);
  itemsRef.current = items;
  selectedRef.current = selected;

  // Filter debounce. Plan owns 120ms; component-side useMemo recomputes off
  // `debouncedFilter`, so typing is responsive without thrashing the list.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(filter), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filter]);

  // Auto-clear toggle error after TTL.
  useEffect(() => {
    if (!toggleError) return;
    const t = setTimeout(() => setToggleError(null), TOGGLE_ERROR_TTL_MS);
    return () => clearTimeout(t);
  }, [toggleError]);

  // ---- Internal helpers -----------------------------------------------------

  const buildItems = useCallback(
    (raws: unknown[]): ScopePickerItem[] =>
      raws.map((raw) => ({
        id: adapter.identity(raw),
        label: adapter.label(raw),
        raw,
      })),
    [adapter]
  );

  // Parse an unknown error into the shape used by ScopePickerState.error. Used
  // by both reload() and reTest().
  const toErrorState = useCallback(
    (err: unknown): Extract<ScopePickerState, { kind: "error" }> => {
      const message = err instanceof Error ? err.message : String(err);
      const isMissingScope =
        message.includes("channels:read") || message.includes("missing_scope");
      return { kind: "error", message, isMissingScope };
    },
    []
  );

  const computeDefaults = useCallback(
    (built: ScopePickerItem[]): ScopePickerItem[] => {
      // Build id → index map ONCE so the comparator is O(1) per call.
      // Without this, sorting 2000 Slack channels was O(n² log n).
      const indexById = new Map<string, number>();
      for (let i = 0; i < built.length; i++) indexById.set(built[i].id, i);
      const eligible = built.filter(
        (it) => !adapter.excludeFromDefaults(it.raw)
      );
      const ranked = [...eligible].sort(
        (a, b) =>
          adapter.rank(b.raw, indexById.get(b.id) ?? 0) -
          adapter.rank(a.raw, indexById.get(a.id) ?? 0)
      );
      return ranked.slice(0, SMART_DEFAULT_COUNT);
    },
    [adapter]
  );

  const persistSelection = useCallback(
    async (next: Set<string>, currentItems: ScopePickerItem[]) => {
      const chosen = currentItems.filter((it) => next.has(it.id));
      const shape = adapter.toConfigShape(chosen);
      await setConfig({ [adapter.configKey]: shape } as Partial<AppConfig>);
    },
    [adapter]
  );

  // ---- Public API -----------------------------------------------------------

  const reload = useCallback(async () => {
    setState({ kind: "loading" });
    setStaleItems([]);
    try {
      const raws = await adapter.fetcher();
      const built = buildItems(raws);
      if (built.length === 0) {
        setItems([]);
        setSelected(new Set());
        setState({ kind: "empty" });
        return;
      }
      const cfg = await getConfig();
      const existing = adapter.fromConfigShape(cfg[adapter.configKey]);
      let nextSelected: Set<string>;
      if (existing.size > 0) {
        // Honor user's prior choice; only keep IDs that still exist.
        nextSelected = new Set(
          built.map((b) => b.id).filter((id) => existing.has(id))
        );
        // Race-fix (prior-config branch): if any prior IDs vanished from the
        // fresh fetch, the pruned set must be persisted BEFORE state flips to
        // "loaded" — otherwise a user clicking Continue immediately runs the
        // pipeline against stale IDs that still live in config.
        if (nextSelected.size !== existing.size) {
          await persistSelection(nextSelected, built);
        }
      } else {
        // Smart defaults — race-fix: flush BEFORE state transitions to loaded.
        const defaults = computeDefaults(built);
        nextSelected = new Set(defaults.map((d) => d.id));
        await persistSelection(nextSelected, built);
      }
      setItems(built);
      setSelected(nextSelected);
      setState({ kind: "loaded", userEdited: userEditedRef.current });
    } catch (err) {
      setState(toErrorState(err));
    }
  }, [adapter, buildItems, computeDefaults, persistSelection, toErrorState]);

  // Kick off the initial load on mount.
  useEffect(() => {
    if (state.kind === "idle") {
      void reload();
    }
    // We deliberately fire only once — `reload` is stable per integration,
    // and re-firing on its identity change would re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(
    async (id: string) => {
      const prev = selectedRef.current;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Optimistic update first so the chip flips instantly.
      setSelected(next);
      try {
        await persistSelection(next, itemsRef.current);
        setToggleError(null);
        userEditedRef.current = true;
        setState((s) =>
          s.kind === "loaded" ? { kind: "loaded", userEdited: true } : s
        );
      } catch {
        // Revert and surface the inline error. Don't promote to a toast —
        // the plan calls for ink-soft inline copy.
        setSelected(prev);
        setToggleError(TOGGLE_ERROR_MESSAGE);
      }
    },
    [persistSelection]
  );

  const setFilter = useCallback((q: string) => setFilterState(q), []);

  const expandAll = useCallback(() => setExpanded(true), []);

  const reTest = useCallback(async () => {
    // Re-fetch and diff against current selection. Items that vanish are
    // surfaced in `staleItems`; selection is pruned to surviving IDs.
    // On fetch/persist failure, transition to error state and PRESERVE the
    // prior selection (per the plan's state matrix).
    try {
      const raws = await adapter.fetcher();
      const built = buildItems(raws);
      const newIds = new Set(built.map((b) => b.id));
      const prevSelected = selectedRef.current;
      const prevItems = itemsRef.current;

      const stale = prevItems.filter(
        (it) => prevSelected.has(it.id) && !newIds.has(it.id)
      );
      const survivingSelected = new Set(
        [...prevSelected].filter((id) => newIds.has(id))
      );

      await persistSelection(survivingSelected, built);
      setItems(built);
      setSelected(survivingSelected);
      setStaleItems(stale);
      // State transitions to "loaded". Preserve userEdited via ref so a user
      // who toggled before hitting an error doesn't see "RECOMMENDED" return.
      setState({ kind: "loaded", userEdited: userEditedRef.current });
    } catch (err) {
      // Selection ref is unchanged; UI continues to show prior chips.
      setState(toErrorState(err));
    }
  }, [adapter, buildItems, persistSelection, toErrorState]);

  // ---- Derived: visibleItems ------------------------------------------------
  // Memo deps cover all four inputs. Without memoization every chip toggle
  // would re-sort the full list (potentially 2000 items for Slack).

  const filteredItems = useMemo(() => {
    if (!debouncedFilter) return items;
    const q = debouncedFilter.toLowerCase();
    return items.filter((it) => it.label.toLowerCase().includes(q));
  }, [items, debouncedFilter]);

  const visibleItems = useMemo(() => {
    if (debouncedFilter) {
      // Filtering: show all matches, no top-N cap, no pinning.
      return filteredItems;
    }
    if (expanded) {
      return [...items].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      );
    }
    // Default: top N by rank desc, with pre-selected items pinned to the top
    // (de-duped). Pre-selected items appear even if they fall outside top N.
    // Pre-compute id → index map to keep the comparator O(1) — without it,
    // sorting 2000 channels on every chip toggle was perceptibly slow.
    const indexById = new Map<string, number>();
    for (let i = 0; i < items.length; i++) indexById.set(items[i].id, i);
    const ranked = [...items].sort(
      (a, b) =>
        adapter.rank(b.raw, indexById.get(b.id) ?? 0) -
        adapter.rank(a.raw, indexById.get(a.id) ?? 0)
    );
    const top = ranked.slice(0, VISIBLE_TOP_N);
    const topIds = new Set(top.map((t) => t.id));
    const pinned = items.filter((it) => selected.has(it.id) && !topIds.has(it.id));
    return [...pinned, ...top];
  }, [items, debouncedFilter, expanded, selected, adapter, filteredItems]);

  return {
    state,
    items,
    visibleItems,
    selected,
    staleItems,
    filter,
    expanded,
    toggleError,
    toggle,
    setFilter,
    expandAll,
    reload,
    reTest,
  };
}
