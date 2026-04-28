// Map each team member to their accounts on every connected provider
// (Slack, GitHub, Linear, Jira). One row per person, one combobox per
// provider — no silent cross-field auto-match. The "Find matches" button
// per row searches all four providers from the display name and shows the
// candidates for confirmation; the user clicks once to apply, never has
// to manually re-pick if the heuristic guessed right.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GhostButton,
  Lede,
  PrimaryButton,
  StepFooter,
  Title,
  inputCls,
} from "./primitives";
import { UserCombobox } from "./UserCombobox";
import {
  listMembers,
  upsertMember,
  getConfig,
} from "../../services/db";
import * as slack from "../../services/slack";
import * as linear from "../../services/linear";
import * as github from "../../services/github";
import { slugify } from "../../services/memory";
import { SECRET_KEYS, getSecret } from "../../services/secrets";
import {
  loadGitHubMemberPool,
  loadJiraUserPool,
  resolveGitHubLabel,
  resolveJiraLabel,
  resolveLinearLabel,
  resolveSlackLabel,
  searchGitHub,
  searchJira,
  searchLinear,
  searchSlack,
  type ProviderUserMatch,
  type TeammateProvider,
} from "../../services/teammateSearch";
import type { GitHubMember } from "../../services/github";
import type { JiraUser } from "../../services/jira";
import type { LinearUser } from "../../services/linear";

interface Row {
  id?: number;
  display_name: string;
  github_handle: string;
  github_label?: string;
  slack_user_id: string;
  slack_label?: string;
  linear_username: string;
  linear_label?: string;
  jira_username: string;
  jira_label?: string;
}

const EMPTY_ROW: Row = {
  display_name: "",
  github_handle: "",
  slack_user_id: "",
  linear_username: "",
  jira_username: "",
};

interface ProviderAvail {
  slack: boolean;
  github: boolean;
  linear: boolean;
  jira: boolean;
}

interface ProviderCaches {
  slack: slack.SlackUser[];
  linear: LinearUser[];
  jira: JiraUser[];
  github: GitHubMember[];
}

interface SmartFillState {
  rowIdx: number;
  candidates: Partial<Record<TeammateProvider, ProviderUserMatch[]>>;
  loading: boolean;
}

export function StepTeam({ onNext }: { onNext: () => void }) {
  const [rows, setRows] = useState<Row[]>([
    { ...EMPTY_ROW },
    { ...EMPTY_ROW },
    { ...EMPTY_ROW },
  ]);
  const [avail, setAvail] = useState<ProviderAvail>({
    slack: false,
    github: false,
    linear: false,
    jira: false,
  });
  const [caches, setCaches] = useState<ProviderCaches>({
    slack: [],
    linear: [],
    jira: [],
    github: [],
  });
  const [githubScopeOK, setGithubScopeOK] = useState(true);
  const [jiraProjectKeys, setJiraProjectKeys] = useState<string[]>([]);
  const [smart, setSmart] = useState<SmartFillState | null>(null);
  // In-flight provider-cache loads. Shared between the eager preload
  // (initial useEffect) and the lazy combobox onLoad path so a focus that
  // races the preload coalesces against the same promise.
  const inflightRef = useRef<Partial<Record<TeammateProvider, Promise<void>>>>({});

  // Initial load: existing members + which providers are connected. We
  // also eagerly preload Slack/Linear/Jira caches when their providers are
  // connected, so resolving labels for already-mapped members on a cold
  // reload doesn't show raw "U05XXXXX" Slack IDs while the user waits for
  // their first focus into a cell to populate the cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await listMembers();
      if (cancelled) return;
      if (existing.length) {
        setRows(
          existing.map((m) => ({
            id: m.id,
            display_name: m.display_name,
            github_handle: m.github_handle || "",
            slack_user_id: m.slack_user_id || "",
            linear_username: m.linear_username || "",
            jira_username: m.jira_username || "",
          }))
        );
      }
      const [slackTok, ghTok, jiraEmail, jiraTok, linearKey, cfg] = await Promise.all([
        getSecret(SECRET_KEYS.slackBot),
        getSecret(SECRET_KEYS.github),
        getSecret(SECRET_KEYS.jiraEmail),
        getSecret(SECRET_KEYS.jiraToken),
        getSecret(SECRET_KEYS.linear),
        getConfig(),
      ]);
      if (cancelled) return;
      const projectKeys = (cfg.selected_jira_projects || []).map((p) => p.key);
      const availability = {
        slack: !!slackTok,
        github: !!ghTok,
        linear: !!linearKey,
        jira: !!(jiraEmail && jiraTok && projectKeys.length),
      };
      setAvail(availability);
      setJiraProjectKeys(projectKeys);

      // Preload connected provider caches in parallel. Each is best-effort:
      // a fetch failure for one provider must not block the others. We
      // also seed inflightRef so a combobox focus that races the preload
      // shares the in-flight promise instead of firing a second request.
      const tasks: Array<Promise<void>> = [];
      const seed = <P extends "slack" | "linear" | "jira" | "github">(
        p: P,
        promise: Promise<void>
      ) => {
        inflightRef.current[p] = promise;
        tasks.push(promise);
      };
      if (availability.slack) {
        seed(
          "slack",
          slack
            .listUsers()
            .then((users) => {
              if (!cancelled) setCaches((c) => ({ ...c, slack: users }));
            })
            .catch(() => {})
            .finally(() => {
              inflightRef.current.slack = undefined;
            })
        );
      }
      if (availability.linear) {
        seed(
          "linear",
          linear
            .listOrgMembers()
            .then((users) => {
              if (!cancelled) setCaches((c) => ({ ...c, linear: users }));
            })
            .catch(() => {})
            .finally(() => {
              inflightRef.current.linear = undefined;
            })
        );
      }
      if (availability.jira) {
        seed(
          "jira",
          loadJiraUserPool(projectKeys)
            .then((users) => {
              if (!cancelled) setCaches((c) => ({ ...c, jira: users }));
            })
            .catch(() => {})
            .finally(() => {
              inflightRef.current.jira = undefined;
            })
        );
      }
      if (availability.github) {
        // Probe scope first so we can show a re-auth prompt rather than
        // silently returning an empty pool when the user's old token
        // doesn't have read:org.
        tasks.push(
          (async () => {
            const ok = await github.hasReadOrgScope().catch(() => false);
            if (cancelled) return;
            setGithubScopeOK(ok);
            if (!ok) return;
            try {
              const members = await loadGitHubMemberPool();
              if (!cancelled) setCaches((c) => ({ ...c, github: members }));
            } catch {
              // pool fetch failed (network, rate limit) — leave empty
            }
          })()
        );
      }
      await Promise.all(tasks);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Loaders for the combobox onLoad hook. With eager preload above these
  // are usually no-ops, but they remain as a safety net for the case where
  // the first mount-load is still in flight when a user focuses a cell.
  // Coalescing via inflightRef ensures concurrent focuses share work, and
  // .finally() always clears the slot — even on rejection, so a transient
  // 401 doesn't poison the slot for the rest of the session.
  const loaders = useMemo(
    () => ({
      slack: () => {
        if (caches.slack.length) return Promise.resolve();
        if (inflightRef.current.slack) return inflightRef.current.slack;
        const p = slack
          .listUsers()
          .then((users) => {
            setCaches((c) => ({ ...c, slack: users }));
          })
          .finally(() => {
            inflightRef.current.slack = undefined;
          });
        inflightRef.current.slack = p;
        return p;
      },
      linear: () => {
        if (caches.linear.length) return Promise.resolve();
        if (inflightRef.current.linear) return inflightRef.current.linear;
        const p = linear
          .listOrgMembers()
          .then((users) => {
            setCaches((c) => ({ ...c, linear: users }));
          })
          .finally(() => {
            inflightRef.current.linear = undefined;
          });
        inflightRef.current.linear = p;
        return p;
      },
      jira: () => {
        if (caches.jira.length) return Promise.resolve();
        if (inflightRef.current.jira) return inflightRef.current.jira;
        const p = loadJiraUserPool(jiraProjectKeys)
          .then((users) => {
            setCaches((c) => ({ ...c, jira: users }));
          })
          .finally(() => {
            inflightRef.current.jira = undefined;
          });
        inflightRef.current.jira = p;
        return p;
      },
      github: () => {
        if (caches.github.length) return Promise.resolve();
        if (!githubScopeOK) return Promise.resolve();
        if (inflightRef.current.github) return inflightRef.current.github;
        const p = loadGitHubMemberPool()
          .then((members) => {
            setCaches((c) => ({ ...c, github: members }));
          })
          .finally(() => {
            inflightRef.current.github = undefined;
          });
        inflightRef.current.github = p;
        return p;
      },
    }),
    [caches, jiraProjectKeys, githubScopeOK]
  );

  const update = (i: number, patch: Partial<Row>) => {
    setRows((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const addRow = () => setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (i: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

  // ── Smart-fill: search all 4 providers from display_name in parallel ──
  const runSmartFill = async (i: number) => {
    const r = rows[i];
    const name = r.display_name.trim();
    if (!name) return;
    setSmart({ rowIdx: i, candidates: {}, loading: true });

    // Make sure caches we need are loaded before searching.
    await Promise.all([
      avail.slack ? loaders.slack() : Promise.resolve(),
      avail.linear ? loaders.linear() : Promise.resolve(),
      avail.jira ? loaders.jira() : Promise.resolve(),
      avail.github && githubScopeOK ? loaders.github() : Promise.resolve(),
    ]);

    const out: Partial<Record<TeammateProvider, ProviderUserMatch[]>> = {};
    if (avail.slack) {
      out.slack = searchSlack(name, caches.slack, 4);
    }
    if (avail.linear) {
      out.linear = searchLinear(name, caches.linear, 4);
    }
    if (avail.jira) {
      out.jira = searchJira(name, caches.jira, 4);
    }
    if (avail.github && githubScopeOK) {
      out.github = searchGitHub(name, caches.github, 4);
    }
    setSmart({ rowIdx: i, candidates: out, loading: false });
  };

  // Apply smart-fill picks, but never overwrite a column the user already set.
  const applySmartFill = (picks: Partial<Record<TeammateProvider, ProviderUserMatch>>) => {
    if (!smart) return;
    const i = smart.rowIdx;
    const r = rows[i];
    const patch: Partial<Row> = {};
    if (picks.slack && !r.slack_user_id) {
      patch.slack_user_id = picks.slack.handle;
      patch.slack_label = picks.slack.label;
    }
    if (picks.github && !r.github_handle) {
      patch.github_handle = picks.github.handle;
      patch.github_label = picks.github.label;
    }
    if (picks.linear && !r.linear_username) {
      patch.linear_username = picks.linear.handle;
      patch.linear_label = picks.linear.label;
    }
    if (picks.jira && !r.jira_username) {
      patch.jira_username = picks.jira.handle;
      patch.jira_label = picks.jira.label;
    }
    update(i, patch);
    setSmart(null);
  };

  const save = async () => {
    for (const r of rows) {
      if (!r.display_name.trim()) continue;
      await upsertMember({
        id: r.id,
        display_name: r.display_name.trim(),
        github_handle: r.github_handle.trim() || null,
        slack_user_id: r.slack_user_id.trim() || null,
        linear_username: r.linear_username.trim() || null,
        jira_username: r.jira_username.trim() || null,
        slug: slugify(r.display_name),
      });
    }
    onNext();
  };

  const nonEmptyCount = rows.filter((r) => r.display_name.trim()).length;
  const anyProviderConnected = avail.slack || avail.github || avail.linear || avail.jira;

  // ── Combobox factories ────────────────────────────────────────────────

  const slackCombo = (i: number, r: Row) => (
    <UserCombobox
      provider="slack"
      value={r.slack_user_id || null}
      label={r.slack_label}
      disabled={!avail.slack}
      disabledHint="Connect Slack to map"
      placeholder="Search Slack…"
      initialSeed={r.display_name}
      search={(q) => searchSlack(q, caches.slack)}
      onLoad={loaders.slack}
      resolveLabel={async (h) => resolveSlackLabel(h, caches.slack)}
      onChange={(m) =>
        update(i, {
          slack_user_id: m?.handle ?? "",
          slack_label: m?.label,
        })
      }
    />
  );

  const githubDisabled = !avail.github || !githubScopeOK;
  const githubDisabledHint = !avail.github
    ? "Connect GitHub to map"
    : !githubScopeOK
      ? "Reconnect GitHub with read:org scope"
      : undefined;
  const githubCombo = (i: number, r: Row) => (
    <UserCombobox
      provider="github"
      value={r.github_handle || null}
      label={r.github_label}
      disabled={githubDisabled}
      disabledHint={githubDisabledHint}
      placeholder="Search GitHub…"
      initialSeed={r.display_name}
      search={(q) => searchGitHub(q, caches.github)}
      onLoad={loaders.github}
      resolveLabel={async (h) => resolveGitHubLabel(h, caches.github)}
      onChange={(m) =>
        update(i, {
          github_handle: m?.handle ?? "",
          github_label: m?.label,
        })
      }
    />
  );

  const linearCombo = (i: number, r: Row) => (
    <UserCombobox
      provider="linear"
      value={r.linear_username || null}
      label={r.linear_label}
      disabled={!avail.linear}
      disabledHint="Connect Linear to map"
      placeholder="Search Linear…"
      initialSeed={r.display_name}
      search={(q) => searchLinear(q, caches.linear)}
      onLoad={loaders.linear}
      resolveLabel={async (h) => resolveLinearLabel(h, caches.linear)}
      onChange={(m) =>
        update(i, {
          linear_username: m?.handle ?? "",
          linear_label: m?.label,
        })
      }
    />
  );

  const jiraCombo = (i: number, r: Row) => (
    <UserCombobox
      provider="jira"
      value={r.jira_username || null}
      label={r.jira_label}
      disabled={!avail.jira}
      disabledHint="Connect Jira to map"
      placeholder="Search Jira…"
      initialSeed={r.display_name}
      search={(q) => searchJira(q, caches.jira)}
      onLoad={loaders.jira}
      resolveLabel={async (h) => resolveJiraLabel(h, caches.jira)}
      onChange={(m) =>
        update(i, {
          jira_username: m?.handle ?? "",
          jira_label: m?.label,
        })
      }
    />
  );

  return (
    <div>
      <Title>Who's on your team?</Title>
      <Lede>
        Map each person to their accounts on every connected tool. Type the
        name, then click <em>Find matches</em> — Keepr searches Slack, GitHub,
        Linear, and Jira in parallel and shows you the top match for each.
        Confirm with one click. Manual override is always one focus away.
      </Lede>

      {!anyProviderConnected && (
        <div className="mb-6 rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink-soft">
          No providers connected yet. You can still add names here and come
          back to map accounts after connecting Slack / GitHub / Linear / Jira.
        </div>
      )}

      {avail.github && !githubScopeOK && (
        <div className="mb-6 rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink-soft">
          GitHub is missing the <span className="mono">read:org</span> scope.
          Reconnect GitHub in Settings to load your org members.
        </div>
      )}
      {avail.github && githubScopeOK && caches.github.length === 0 && (
        <div className="mb-6 rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-ink-soft">
          GitHub connected, but you don't appear to belong to any GitHub
          orgs — there are no teammates to map from GitHub.
        </div>
      )}

      <div className="mb-2 grid grid-cols-[1.1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-1 text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        <span>Name</span>
        <span>GitHub</span>
        <span>Slack</span>
        <span>Linear</span>
        <span>Jira</span>
        <span />
      </div>

      <div className="mb-4 flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[1.1fr_1fr_1fr_1fr_1fr_auto] gap-2 items-start">
              <input
                className={inputCls}
                placeholder="Display name"
                value={r.display_name}
                onChange={(e) => update(i, { display_name: e.target.value })}
              />
              {githubCombo(i, r)}
              {slackCombo(i, r)}
              {linearCombo(i, r)}
              {jiraCombo(i, r)}
              <button
                onClick={() => removeRow(i)}
                className="text-xs text-ink-faint hover:text-ink transition-colors px-1 self-center"
                aria-label="Remove row"
                tabIndex={-1}
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-3 px-1">
              <button
                type="button"
                onClick={() => runSmartFill(i)}
                disabled={!r.display_name.trim() || !anyProviderConnected}
                className="text-[11px] text-ink-faint hover:text-ink underline-offset-2 hover:underline disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Find matches across all
              </button>
              {smart?.rowIdx === i && smart.loading && (
                <span className="text-[11px] text-ink-faint breathing">
                  Searching all providers…
                </span>
              )}
              {smart?.rowIdx === i && !smart.loading && (
                <SmartFillPanel
                  candidates={smart.candidates}
                  row={r}
                  onApply={applySmartFill}
                  onCancel={() => setSmart(null)}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-8">
        <GhostButton onClick={addRow}>+ Add member</GhostButton>
      </div>

      <StepFooter>
        <PrimaryButton onClick={save} disabled={nonEmptyCount === 0}>
          Save {nonEmptyCount} {nonEmptyCount === 1 ? "member" : "members"}
        </PrimaryButton>
      </StepFooter>
    </div>
  );
}

// ── Smart-fill confirmation panel ─────────────────────────────────────────

function SmartFillPanel({
  candidates,
  row,
  onApply,
  onCancel,
}: {
  candidates: Partial<Record<TeammateProvider, ProviderUserMatch[]>>;
  row: Row;
  onApply: (picks: Partial<Record<TeammateProvider, ProviderUserMatch>>) => void;
  onCancel: () => void;
}) {
  // Default pick = top candidate per provider. Computed once at mount —
  // safe because the parent only renders this after candidates are ready.
  const [picks, setPicks] = useState(() => {
    const initial: Partial<Record<TeammateProvider, ProviderUserMatch>> = {};
    for (const p of ["slack", "github", "linear", "jira"] as const) {
      const list = candidates[p] || [];
      if (list.length) initial[p] = list[0];
    }
    return initial;
  });

  const present: TeammateProvider[] = (["slack", "github", "linear", "jira"] as const).filter(
    (p) => (candidates[p] || []).length > 0
  );

  if (!present.length) {
    return (
      <span className="text-[11px] text-ink-faint">
        No matches found.{" "}
        <button onClick={onCancel} className="underline hover:text-ink">
          Dismiss
        </button>
      </span>
    );
  }

  const alreadySetMessage = (p: TeammateProvider): string | null => {
    if (p === "slack" && row.slack_user_id) return "Already set — won't overwrite";
    if (p === "github" && row.github_handle) return "Already set — won't overwrite";
    if (p === "linear" && row.linear_username) return "Already set — won't overwrite";
    if (p === "jira" && row.jira_username) return "Already set — won't overwrite";
    return null;
  };

  return (
    <div className="flex flex-col gap-1 rounded-md border border-hairline bg-surface px-3 py-2 text-xs">
      {present.map((p) => {
        const list = candidates[p] || [];
        const skip = alreadySetMessage(p);
        return (
          <div key={p} className="flex items-center gap-2">
            <span className="w-14 uppercase tracking-[0.14em] text-[10px] text-ink-faint">
              {p}
            </span>
            {skip ? (
              <span className="text-ink-faint italic">{skip}</span>
            ) : (
              <select
                className="rounded border border-hairline bg-canvas px-2 py-0.5 text-xs"
                value={picks[p]?.id || ""}
                onChange={(e) => {
                  const next = list.find((x) => x.id === e.target.value);
                  setPicks((s) => ({ ...s, [p]: next }));
                }}
              >
                {list.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.detail ? ` — ${m.detail}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onApply(picks)}
          className="rounded bg-ink px-2 py-1 text-[11px] text-canvas hover:bg-ink-soft"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-ink-faint hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
