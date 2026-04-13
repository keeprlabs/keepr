// Settings — same primitives as onboarding; just a flat list of panels.

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  getConfig,
  listMembers,
  setConfig,
  upsertIntegration,
  upsertMember,
  deleteMember,
} from "../services/db";
import { SECRET_KEYS, getSecret, setSecret } from "../services/secrets";
import { getProvider, type LLMProviderId } from "../services/llm";
import { defaultMemoryDir } from "../services/fsio";
import { slugify } from "../services/memory";
import * as slack from "../services/slack";
import * as github from "../services/github";
import * as jira from "../services/jira";
import * as linear from "../services/linear";
import type { AppConfig, TeamMember } from "../lib/types";
import { DEFAULT_CONFIG } from "../lib/types";

export function Settings() {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [slackChannels, setSlackChannels] = useState<slack.SlackChannel[]>([]);
  const [ghRepos, setGhRepos] = useState<Array<{ full_name: string; owner: { login: string } }>>([]);
  const [llmKey, setLlmKey] = useState("");
  const [llmSaveStatus, setLlmSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [slackToken, setSlackToken] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraUrl, setJiraUrl] = useState("");
  const [jiraProjects, setJiraProjects] = useState<jira.JiraProjectRemote[]>([]);
  const [linearKey, setLinearKey] = useState("");
  const [linearTeams, setLinearTeams] = useState<linear.LinearTeamRemote[]>([]);

  const load = async () => {
    const freshCfg = await getConfig();
    setCfg(freshCfg);
    setMembers(await listMembers());
    // Read the key for whichever provider is currently active.
    const activeProvider = freshCfg.llm_provider || "anthropic";
    setLlmKey((await getSecret(SECRET_KEYS[activeProvider])) || "");
    setLlmSaveStatus("idle");
    setSlackToken((await getSecret(SECRET_KEYS.slackBot)) || "");
    setGhToken((await getSecret(SECRET_KEYS.github)) || "");
    setJiraEmail((await getSecret(SECRET_KEYS.jiraEmail)) || "");
    setJiraToken((await getSecret(SECRET_KEYS.jiraToken)) || "");
    setJiraUrl(freshCfg.jira_cloud_url || "");
    setLinearKey((await getSecret(SECRET_KEYS.linear)) || "");
  };

  useEffect(() => {
    load();
  }, []);

  const pickMemoryDir = async () => {
    const chosen = await openDialog({ directory: true, multiple: false });
    if (typeof chosen === "string") {
      await setConfig({ memory_dir: chosen });
      load();
    }
  };

  const loadSlackChannels = async () => {
    try {
      setSlackChannels(await slack.listPublicChannels());
    } catch (e: any) {
      alert(`Slack error: ${e.message}`);
    }
  };

  const loadGhRepos = async () => {
    try {
      setGhRepos((await github.listUserRepos()) as any);
    } catch (e: any) {
      alert(`GitHub error: ${e.message}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[720px] px-12 pt-20 pb-24 rise">
        <div className="mb-2 text-xxs uppercase tracking-[0.14em] text-ink-faint">
          Preferences
        </div>
        <h1 className="display-serif-lg mb-14 text-[40px] leading-[1.05] text-ink">
          Settings
        </h1>

        <Panel title="Model">
          <div className="mb-3 flex gap-2">
            {(["anthropic", "openai", "openrouter"] as LLMProviderId[]).map((id) => (
              <button
                key={id}
                onClick={async () => {
                  const p = getProvider(id);
                  await setConfig({
                    llm_provider: id,
                    synthesis_model: p.defaultSynthesisModel,
                    classifier_model: p.defaultClassifierModel,
                  });
                  // load() will read the key for the newly-active provider.
                  await load();
                }}
                className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize transition-all duration-180 ease-calm ${
                  cfg.llm_provider === id
                    ? "border-ink/35 text-ink"
                    : "border-hairline text-ink-soft hover:border-ink/20"
                }`}
              >
                {id}
              </button>
            ))}
          </div>
          {(() => {
            const activeProvider = (cfg.llm_provider || "anthropic") as LLMProviderId;
            const p = getProvider(activeProvider);
            return (
              <Field label={`${p.label} API key`}>
                <div className="flex gap-2">
                  <input
                    type="password"
                    className={inputCls}
                    value={llmKey}
                    placeholder="sk-…"
                    onChange={(e) => {
                      setLlmKey(e.target.value);
                      if (llmSaveStatus !== "idle") setLlmSaveStatus("idle");
                    }}
                  />
                  <Ghost
                    onClick={async () => {
                      try {
                        await setSecret(
                          SECRET_KEYS[activeProvider],
                          llmKey.trim()
                        );
                        // Read-back verification — catches silent keychain
                        // failures in unsigned dev builds.
                        const readBack = await getSecret(
                          SECRET_KEYS[activeProvider]
                        );
                        if (readBack !== llmKey.trim()) {
                          throw new Error(
                            "Key did not persist (keychain read-back mismatch)"
                          );
                        }
                        setLlmSaveStatus("saved");
                        setTimeout(() => setLlmSaveStatus("idle"), 1800);
                      } catch (e: any) {
                        // eslint-disable-next-line no-console
                        console.error("[keepr] setSecret failed:", e);
                        setLlmSaveStatus("error");
                      }
                    }}
                  >
                    {llmSaveStatus === "saved"
                      ? "Saved"
                      : llmSaveStatus === "error"
                      ? "Failed"
                      : "Save"}
                  </Ghost>
                  <Ghost onClick={() => openExternal(p.keyUrl)}>
                    Open dashboard
                  </Ghost>
                </div>
              </Field>
            );
          })()}
          <Field label="Synthesis model">
            <input
              className={inputCls}
              value={cfg.synthesis_model}
              onChange={(e) => setCfg({ ...cfg, synthesis_model: e.target.value })}
              onBlur={() => setConfig({ synthesis_model: cfg.synthesis_model })}
            />
          </Field>
          <Field label="Classifier model">
            <input
              className={inputCls}
              value={cfg.classifier_model}
              onChange={(e) => setCfg({ ...cfg, classifier_model: e.target.value })}
              onBlur={() => setConfig({ classifier_model: cfg.classifier_model })}
            />
          </Field>
        </Panel>

        <Panel title="Slack">
          <Field label="Bot token">
            <div className="flex gap-2">
              <input type="password" className={inputCls} value={slackToken} onChange={(e) => setSlackToken(e.target.value)} />
              <Ghost onClick={async () => {
                await setSecret(SECRET_KEYS.slackBot, slackToken);
                if (slackToken.trim()) {
                  await upsertIntegration("slack", {});
                }
                alert("Saved");
              }}>Save</Ghost>
            </div>
          </Field>
          <div className="mb-3">
            <Ghost onClick={loadSlackChannels}>Load public channels</Ghost>
          </div>
          <div className="flex flex-wrap gap-2">
            {slackChannels.map((ch) => {
              const on = cfg.selected_slack_channels.some((c) => c.id === ch.id);
              return (
                <button
                  key={ch.id}
                  onClick={async () => {
                    const next = on
                      ? cfg.selected_slack_channels.filter((c) => c.id !== ch.id)
                      : [...cfg.selected_slack_channels, { id: ch.id, name: ch.name }].slice(0, 10);
                    await setConfig({ selected_slack_channels: next });
                    setCfg({ ...cfg, selected_slack_channels: next });
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition-all duration-180 ease-calm ${
                    on
                      ? "border-ink/80 bg-ink text-canvas"
                      : "border-hairline text-ink-soft hover:border-ink/25 hover:text-ink"
                  }`}
                >
                  #{ch.name}
                </button>
              );
            })}
          </div>
          {cfg.selected_slack_channels.length > 0 && (
            <div className="mt-3 text-xxs text-ink-faint">
              {cfg.selected_slack_channels.length}/10 channels selected
            </div>
          )}
        </Panel>

        <Panel title="GitHub">
          <Field label="Personal access token">
            <div className="flex gap-2">
              <input type="password" className={inputCls} value={ghToken} onChange={(e) => setGhToken(e.target.value)} />
              <Ghost onClick={async () => {
                await setSecret(SECRET_KEYS.github, ghToken);
                if (ghToken.trim()) {
                  await upsertIntegration("github", {});
                }
                alert("Saved");
              }}>Save</Ghost>
            </div>
          </Field>
          <div className="mb-3">
            <Ghost onClick={loadGhRepos}>Load my repos</Ghost>
          </div>
          <div className="flex flex-wrap gap-2">
            {ghRepos.map((r) => {
              const [owner, repo] = r.full_name.split("/");
              const on = cfg.selected_github_repos.some((x) => x.owner === owner && x.repo === repo);
              return (
                <button
                  key={r.full_name}
                  onClick={async () => {
                    const next = on
                      ? cfg.selected_github_repos.filter((x) => !(x.owner === owner && x.repo === repo))
                      : [...cfg.selected_github_repos, { owner, repo }];
                    await setConfig({ selected_github_repos: next });
                    setCfg({ ...cfg, selected_github_repos: next });
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition-all duration-180 ease-calm ${
                    on
                      ? "border-ink/80 bg-ink text-canvas"
                      : "border-hairline text-ink-soft hover:border-ink/25 hover:text-ink"
                  }`}
                >
                  {r.full_name}
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Jira">
          <Field label="Atlassian Cloud URL">
            <div className="flex gap-2">
              <input className={inputCls} value={jiraUrl} placeholder="https://your-org.atlassian.net" onChange={(e) => setJiraUrl(e.target.value)} />
              <Ghost onClick={async () => { await setConfig({ jira_cloud_url: jiraUrl }); alert("Saved"); }}>Save</Ghost>
            </div>
          </Field>
          <Field label="Email">
            <input className={inputCls} value={jiraEmail} placeholder="you@company.com" onChange={(e) => setJiraEmail(e.target.value)} />
          </Field>
          <Field label="API token">
            <div className="flex gap-2">
              <input type="password" className={inputCls} value={jiraToken} placeholder="Jira API token" onChange={(e) => setJiraToken(e.target.value)} />
              <Ghost onClick={async () => {
                await setSecret(SECRET_KEYS.jiraEmail, jiraEmail);
                await setSecret(SECRET_KEYS.jiraToken, jiraToken);
                await setConfig({ jira_cloud_url: jiraUrl });
                if (jiraEmail.trim() && jiraToken.trim()) {
                  await upsertIntegration("jira", { email: jiraEmail.trim() });
                }
                alert("Saved");
              }}>Save</Ghost>
              <Ghost onClick={() => openExternal("https://id.atlassian.com/manage-profile/security/api-tokens")}>Get token</Ghost>
            </div>
          </Field>
          <div className="mb-3">
            <Ghost onClick={async () => {
              try {
                setJiraProjects(await jira.listProjects());
              } catch (e: any) {
                alert(`Jira error: ${e.message}`);
              }
            }}>Load projects</Ghost>
          </div>
          <div className="flex flex-wrap gap-2">
            {jiraProjects.map((p) => {
              const on = (cfg.selected_jira_projects || []).some((x) => x.id === p.id);
              return (
                <button
                  key={p.id}
                  onClick={async () => {
                    const current = cfg.selected_jira_projects || [];
                    const next = on
                      ? current.filter((x) => x.id !== p.id)
                      : [...current, { id: p.id, key: p.key, name: p.name }];
                    await setConfig({ selected_jira_projects: next });
                    setCfg({ ...cfg, selected_jira_projects: next });
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition-all duration-180 ease-calm ${
                    on
                      ? "border-ink/80 bg-ink text-canvas"
                      : "border-hairline text-ink-soft hover:border-ink/25 hover:text-ink"
                  }`}
                >
                  {p.key} — {p.name}
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Linear">
          <Field label="API key">
            <div className="flex gap-2">
              <input type="password" className={inputCls} value={linearKey} placeholder="lin_api_..." onChange={(e) => setLinearKey(e.target.value)} />
              <Ghost onClick={async () => {
                await setSecret(SECRET_KEYS.linear, linearKey);
                if (linearKey.trim()) {
                  await upsertIntegration("linear", {});
                }
                alert("Saved");
              }}>Save</Ghost>
              <Ghost onClick={() => openExternal("https://linear.app/settings/account/security")}>Get key</Ghost>
            </div>
          </Field>
          <div className="mb-3">
            <Ghost onClick={async () => {
              try {
                setLinearTeams(await linear.listTeams());
              } catch (e: any) {
                alert(`Linear error: ${e.message}`);
              }
            }}>Load teams</Ghost>
          </div>
          <div className="flex flex-wrap gap-2">
            {linearTeams.map((t) => {
              const on = (cfg.selected_linear_teams || []).some((x) => x.id === t.id);
              return (
                <button
                  key={t.id}
                  onClick={async () => {
                    const current = cfg.selected_linear_teams || [];
                    const next = on
                      ? current.filter((x) => x.id !== t.id)
                      : [...current, { id: t.id, key: t.key, name: t.name }];
                    await setConfig({ selected_linear_teams: next });
                    setCfg({ ...cfg, selected_linear_teams: next });
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition-all duration-180 ease-calm ${
                    on
                      ? "border-ink/80 bg-ink text-canvas"
                      : "border-hairline text-ink-soft hover:border-ink/25 hover:text-ink"
                  }`}
                >
                  {t.key} — {t.name}
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Team members">
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <div key={m.id} className="flex flex-col gap-1.5 rounded-md border border-hairline p-3 mb-2">
                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <input
                    className={inputCls}
                    value={m.display_name}
                    placeholder="Display name"
                    onChange={(e) => setMembers(members.map((x) => x.id === m.id ? { ...x, display_name: e.target.value } : x))}
                  />
                  <input
                    className={inputCls}
                    placeholder="GitHub handle"
                    value={m.github_handle || ""}
                    onChange={(e) => setMembers(members.map((x) => x.id === m.id ? { ...x, github_handle: e.target.value } : x))}
                  />
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
                  <input
                    className={inputCls}
                    placeholder="Slack user ID"
                    value={m.slack_user_id || ""}
                    onChange={(e) => setMembers(members.map((x) => x.id === m.id ? { ...x, slack_user_id: e.target.value } : x))}
                  />
                  <input
                    className={inputCls}
                    placeholder="Jira display name"
                    value={m.jira_username || ""}
                    onChange={(e) => setMembers(members.map((x) => x.id === m.id ? { ...x, jira_username: e.target.value } : x))}
                  />
                  <input
                    className={inputCls}
                    placeholder="Linear display name"
                    value={m.linear_username || ""}
                    onChange={(e) => setMembers(members.map((x) => x.id === m.id ? { ...x, linear_username: e.target.value } : x))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Ghost onClick={async () => {
                    await upsertMember({
                      id: m.id,
                      display_name: m.display_name,
                      github_handle: m.github_handle,
                      slack_user_id: m.slack_user_id,
                      jira_username: m.jira_username,
                      linear_username: m.linear_username,
                      slug: slugify(m.display_name),
                    });
                    load();
                  }}>Save</Ghost>
                  <button onClick={async () => { await deleteMember(m.id); load(); }} className="text-xs text-ink-faint hover:text-ink">delete</button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Ghost onClick={async () => {
              await upsertMember({ display_name: "New member", slug: `new-member-${Date.now()}` });
              load();
            }}>+ Add</Ghost>
          </div>
        </Panel>

        <Panel title="Engineering rubric">
          <p className="mb-3 text-xs text-ink-faint">
            Paste your engineering ladder as markdown. Used by perf evaluation and promo readiness workflows.
          </p>
          <textarea
            className={`${inputCls} min-h-[120px] resize-y font-mono text-xs`}
            value={cfg.engineering_rubric || ""}
            placeholder={"# Engineering Ladder\n\n## L3 — Mid-level\n- Technical execution: ...\n- Collaboration: ...\n\n## L4 — Senior\n- Technical execution: ...\n- Collaboration: ..."}
            onChange={(e) => setCfg({ ...cfg, engineering_rubric: e.target.value })}
            onBlur={() => setConfig({ engineering_rubric: cfg.engineering_rubric || null })}
          />
        </Panel>

        <Panel title="Memory directory">
          <div className="flex gap-2">
            <input
              className={inputCls}
              value={cfg.memory_dir}
              readOnly
              placeholder={""}
            />
            <Ghost onClick={pickMemoryDir}>Browse…</Ghost>
            <Ghost onClick={async () => {
              const def = await defaultMemoryDir();
              await setConfig({ memory_dir: def });
              load();
            }}>Use default</Ghost>
          </div>
        </Panel>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-ghost focus:border-ink/40 focus:outline-none transition-colors duration-180";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="hair-b mb-10 pb-10 last:mb-0 last:pb-0 last:border-0">
      <div className="grid grid-cols-[180px_1fr] gap-10">
        <h2 className="pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          {title}
        </h2>
        <div>{children}</div>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

function Ghost(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-hairline bg-canvas px-3 py-2 text-xs text-ink-soft transition-all duration-180 ease-calm hover:border-ink/20 hover:text-ink"
    />
  );
}
