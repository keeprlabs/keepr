// Settings — same primitives as onboarding; just a flat list of panels.

import { useEffect, useRef, useState } from "react";
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
import {
  friendlyProviderError,
  getProvider,
  invalidateClaudeProbe,
  invalidateCodexProbe,
  probeClaudeCode,
  probeCodex,
  providersByCategory,
  setCustomConfig,
  type LLMCategory,
  type LLMProviderId,
  type ProbeResult,
} from "../services/llm";
import { CategoryDivider } from "../components/primitives/CategoryDivider";
import { CliProviderPanel } from "../components/primitives/CliProviderPanel";
import { defaultMemoryDir } from "../services/fsio";
import { slugify } from "../services/memory";
import * as slack from "../services/slack";
import * as github from "../services/github";
import * as gitlab from "../services/gitlab";
import * as jira from "../services/jira";
import * as linear from "../services/linear";
import type { AppConfig, FeatureFlags, TeamMember } from "../lib/types";
import { DEFAULT_CONFIG, DEFAULT_FEATURE_FLAGS } from "../lib/types";
import { GitHubIcon, GitLabIcon, SlackIcon, JiraIcon, LinearIcon } from "../components/primitives/SourceBadge";
import { ChipGrid, SourceChip } from "../components/onboarding/primitives";
import type { IntegrationKind } from "../services/pulseOutcome";

export function Settings({
  focusKind,
}: {
  /** When rendered via the RunOverlay "Fix in Settings" button with a single
   *  broken integration kind, scroll that panel into view on mount. */
  focusKind?: IntegrationKind;
} = {}) {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [slackChannels, setSlackChannels] = useState<slack.SlackChannel[]>([]);
  const [ghRepos, setGhRepos] = useState<Array<{ full_name: string; owner: { login: string } }>>([]);
  const [glProjects, setGlProjects] = useState<gitlab.GitLabProjectRemote[]>([]);
  const [llmKey, setLlmKey] = useState("");
  // CLI provider probe state. Lazy: only fires when the active provider is
  // codex / claude-code, so users opening Settings to fix Slack don't pay
  // for a silent OpenAI/Anthropic billing call. The probe helpers carry
  // their own module-level cache, so the onboarding probe satisfies this one.
  const [codexProbe, setCodexProbe] = useState<ProbeResult | null>(null);
  const [claudeProbe, setClaudeProbe] = useState<ProbeResult | null>(null);
  const [llmSaveError, setLlmSaveError] = useState<string>("");
  const [slackToken, setSlackToken] = useState("");
  const [ghToken, setGhToken] = useState("");
  const [glToken, setGlToken] = useState("");
  const [glInstanceUrl, setGlInstanceUrl] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraUrl, setJiraUrl] = useState("");
  const [jiraProjects, setJiraProjects] = useState<jira.JiraProjectRemote[]>([]);
  const [linearKey, setLinearKey] = useState("");
  const [linearTeams, setLinearTeams] = useState<linear.LinearTeamRemote[]>([]);
  const [llmSaveStatus, setLlmSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const [slackUsers, setSlackUsers] = useState<slack.SlackUser[]>([]);
  const [slackUsersLoaded, setSlackUsersLoaded] = useState(false);
  const [jiraUsers, setJiraUsers] = useState<jira.JiraUser[]>([]);
  const [jiraUsersLoaded, setJiraUsersLoaded] = useState(false);
  const [linearUsers, setLinearUsers] = useState<linear.LinearUser[]>([]);
  const [linearUsersLoaded, setLinearUsersLoaded] = useState(false);

  const load = async () => {
    const freshCfg = await getConfig();
    setCfg(freshCfg);
    setMembers(await listMembers());
    // Read the key for whichever provider is currently active.
    const activeProvider = freshCfg.llm_provider || "anthropic";
    if (activeProvider === "claude-code" || activeProvider === "codex") {
      setLlmKey("");
    } else {
      setLlmKey((await getSecret(SECRET_KEYS[activeProvider])) || "");
    }
    setLlmSaveStatus("idle");
    setLlmSaveError("");
    setSlackToken((await getSecret(SECRET_KEYS.slackBot)) || "");
    setGhToken((await getSecret(SECRET_KEYS.github)) || "");
    setGlToken((await getSecret(SECRET_KEYS.gitlab)) || "");
    setGlInstanceUrl(freshCfg.gitlab_instance_url || "https://gitlab.com");
    setJiraEmail((await getSecret(SECRET_KEYS.jiraEmail)) || "");
    setJiraToken((await getSecret(SECRET_KEYS.jiraToken)) || "");
    setJiraUrl(freshCfg.jira_cloud_url || "");
    setLinearKey((await getSecret(SECRET_KEYS.linear)) || "");
  };

  useEffect(() => {
    load();
  }, []);

  // Lazy CLI probe: only fire when the active provider is a CLI tool, so
  // users opening Settings to fix Slack don't trigger a silent OpenAI/Anthropic
  // billing call. The probe helpers are cached at the module level — if
  // onboarding already probed, this is a free read.
  useEffect(() => {
    let cancelled = false;
    const provider = cfg.llm_provider;
    if (provider === "codex") {
      probeCodex(false).then((r) => { if (!cancelled) setCodexProbe(r); });
    } else if (provider === "claude-code") {
      probeClaudeCode(false).then((r) => { if (!cancelled) setClaudeProbe(r); });
    }
    return () => { cancelled = true; };
  }, [cfg.llm_provider]);

  // Scroll to a specific integration panel when caller (typically the
  // RunOverlay "Fix in Settings" button) passed a focusKind. Waits for
  // layout via double-rAF — one frame for React commit, a second for the
  // browser to lay out fonts/icons. More reliable than a fixed setTimeout
  // across slow hardware.
  useEffect(() => {
    if (!focusKind) return;
    const id = `panel-${focusKind}`;
    let cancelled = false;
    const frame1 = requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame1);
    };
  }, [focusKind]);

  // Auto-load gating: if the user has no prior selections for Slack/GitHub,
  // kick off the lister on first open so they see chips without clicking.
  // Power users with 200+ channels keep the explicit "Reload" affordance —
  // no fetch tax on every Settings visit.
  //
  // Refs (not state) so the guard reads the latest value without stale-
  // closure bugs when load() resolves after the user has already typed a
  // token; deps cover every input the effect actually reads.
  const slackAutoLoadedRef = useRef(false);
  const ghAutoLoadedRef = useRef(false);
  const glAutoLoadedRef = useRef(false);
  useEffect(() => {
    if (
      !slackAutoLoadedRef.current &&
      cfg.selected_slack_channels.length === 0 &&
      slackChannels.length === 0 &&
      slackToken.trim()
    ) {
      slackAutoLoadedRef.current = true;
      void loadSlackChannels();
    }
    if (
      !ghAutoLoadedRef.current &&
      cfg.selected_github_repos.length === 0 &&
      ghRepos.length === 0 &&
      ghToken.trim()
    ) {
      ghAutoLoadedRef.current = true;
      void loadGhRepos();
    }
    if (
      !glAutoLoadedRef.current &&
      (cfg.selected_gitlab_projects || []).length === 0 &&
      glProjects.length === 0 &&
      glToken.trim()
    ) {
      glAutoLoadedRef.current = true;
      void loadGlProjects();
    }
  }, [
    cfg.selected_slack_channels.length,
    cfg.selected_github_repos.length,
    (cfg.selected_gitlab_projects || []).length,
    slackChannels.length,
    ghRepos.length,
    glProjects.length,
    slackToken,
    ghToken,
    glToken,
  ]);

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

  const loadGlProjects = async () => {
    try {
      setGlProjects(await gitlab.listUserProjects());
    } catch (e: any) {
      alert(`GitLab error: ${e.message}`);
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
          <CategorizedProviderRow
            active={(cfg.llm_provider || "anthropic") as LLMProviderId}
            onPick={async (id) => {
              const p = getProvider(id);
              const patch: Record<string, any> = { llm_provider: id };
              if (id === "custom") {
                patch.synthesis_model = cfg.custom_llm_synthesis_model || cfg.synthesis_model;
                patch.classifier_model = cfg.custom_llm_classifier_model || cfg.classifier_model;
              } else {
                patch.synthesis_model = p.defaultSynthesisModel;
                patch.classifier_model = p.defaultClassifierModel;
              }
              await setConfig(patch);
              // load() will read the key (or skip it for CLI providers) and
              // the provider-change useEffect will trigger the lazy probe.
              await load();
            }}
          />
          {(() => {
            const activeProvider = (cfg.llm_provider || "anthropic") as LLMProviderId;
            const p = getProvider(activeProvider);

            const saveKey = async () => {
              try {
                await setSecret(SECRET_KEYS[activeProvider], llmKey.trim());
                const readBack = await getSecret(SECRET_KEYS[activeProvider]);
                if (readBack !== llmKey.trim()) {
                  throw new Error("Key did not persist (keychain read-back mismatch)");
                }
                if (activeProvider === "custom") {
                  await setConfig({
                    custom_llm_base_url: cfg.custom_llm_base_url,
                    custom_llm_synthesis_model: cfg.custom_llm_synthesis_model,
                    custom_llm_classifier_model: cfg.custom_llm_classifier_model,
                    synthesis_model: cfg.custom_llm_synthesis_model,
                    classifier_model: cfg.custom_llm_classifier_model,
                  });
                  setCustomConfig({
                    base_url: cfg.custom_llm_base_url,
                    synthesis_model: cfg.custom_llm_synthesis_model,
                    classifier_model: cfg.custom_llm_classifier_model,
                  });
                }
                setLlmSaveStatus("saved");
                setLlmSaveError("");
                setTimeout(() => setLlmSaveStatus("idle"), 1800);
              } catch (e: any) {
                setLlmSaveStatus("error");
                setLlmSaveError(friendlyProviderError(e, activeProvider));
              }
            };

            if (activeProvider === "claude-code" || activeProvider === "codex") {
              const probe = activeProvider === "codex" ? codexProbe : claudeProbe;
              const onRetry = () => {
                if (activeProvider === "codex") {
                  invalidateCodexProbe();
                  probeCodex(true).then(setCodexProbe);
                } else {
                  invalidateClaudeProbe();
                  probeClaudeCode(true).then(setClaudeProbe);
                }
              };
              return (
                <CliProviderPanel
                  provider={p}
                  probe={probe}
                  onRetry={probe && !probe.ok ? onRetry : undefined}
                  otherErrorMessage={
                    probe && !probe.ok && probe.reason === "other"
                      ? friendlyProviderError(new Error(probe.raw), activeProvider)
                      : undefined
                  }
                />
              );
            }

            if (activeProvider === "custom") {
              return (
                <>
                  <Field label="Base URL">
                    <input
                      className={inputCls}
                      value={cfg.custom_llm_base_url || ""}
                      placeholder="http://localhost:11434"
                      onChange={(e) => setCfg({ ...cfg, custom_llm_base_url: e.target.value })}
                      onBlur={() => setConfig({ custom_llm_base_url: cfg.custom_llm_base_url })}
                    />
                  </Field>
                  <Field label="API key (optional)">
                    <div className="flex gap-2">
                      <input
                        type="password"
                        className={inputCls}
                        value={llmKey}
                        placeholder="optional"
                        onChange={(e) => {
                          setLlmKey(e.target.value);
                          if (llmSaveStatus !== "idle") setLlmSaveStatus("idle");
                        }}
                      />
                      <Ghost onClick={saveKey}>
                        {llmSaveStatus === "saved" ? "Saved" : llmSaveStatus === "error" ? "Failed" : "Save"}
                      </Ghost>
                    </div>
                  </Field>
                </>
              );
            }

            return (
              <Field label={`${p.label} API key`}>
                <div className="flex gap-2">
                  <input
                    type="password"
                    className={inputCls}
                    value={llmKey}
                    placeholder="sk-…"
                    onChange={(e) => setLlmKey(e.target.value)}
                  />
                  <Ghost onClick={saveKey}>
                    {llmSaveStatus === "saved" ? "Saved" : llmSaveStatus === "error" ? "Failed" : "Save"}
                  </Ghost>
                  <Ghost onClick={() => openExternal(p.keyUrl)}>
                    Open dashboard
                  </Ghost>
                </div>
              </Field>
            );
          })()}
          {/* Friendly error copy for saveKey failures. Lives outside the
              branch IIFE so it renders for both hosted and custom flows
              (saveKey is only called from those two branches). aria-live
              polite matches the SaveButton/AutoSaveInput convention used
              elsewhere in this file — no aggressive screen-reader interrupt. */}
          {llmSaveStatus === "error" && llmSaveError && (
            <p
              className="-mt-2 mb-3 text-xxs leading-snug text-ink-faint"
              aria-live="polite"
            >
              {llmSaveError}
            </p>
          )}
          <Field label="Synthesis model">
            <AutoSaveInput
              className={inputCls}
              value={cfg.llm_provider === "custom" ? (cfg.custom_llm_synthesis_model || "") : cfg.synthesis_model}
              placeholder={cfg.llm_provider === "custom" ? "e.g. llama3.1:70b" : undefined}
              onChange={(e) => {
                if (cfg.llm_provider === "custom") {
                  setCfg({ ...cfg, custom_llm_synthesis_model: e.target.value, synthesis_model: e.target.value });
                } else {
                  setCfg({ ...cfg, synthesis_model: e.target.value });
                }
              }}
              onSave={async () => {
                if (cfg.llm_provider === "custom") {
                  await setConfig({ custom_llm_synthesis_model: cfg.custom_llm_synthesis_model, synthesis_model: cfg.custom_llm_synthesis_model });
                } else {
                  await setConfig({ synthesis_model: cfg.synthesis_model });
                }
              }}
            />
          </Field>
          <Field label="Classifier model">
            <AutoSaveInput
              className={inputCls}
              value={cfg.llm_provider === "custom" ? (cfg.custom_llm_classifier_model || "") : cfg.classifier_model}
              placeholder={cfg.llm_provider === "custom" ? "e.g. llama3.1:8b" : undefined}
              onChange={(e) => {
                if (cfg.llm_provider === "custom") {
                  setCfg({ ...cfg, custom_llm_classifier_model: e.target.value, classifier_model: e.target.value });
                } else {
                  setCfg({ ...cfg, classifier_model: e.target.value });
                }
              }}
              onSave={async () => {
                if (cfg.llm_provider === "custom") {
                  await setConfig({ custom_llm_classifier_model: cfg.custom_llm_classifier_model, classifier_model: cfg.custom_llm_classifier_model });
                } else {
                  await setConfig({ classifier_model: cfg.classifier_model });
                }
              }}
            />
          </Field>
        </Panel>

        <Panel title="Slack">
          <Field label="Bot token">
            <div className="flex gap-2">
              <input type="password" className={inputCls} value={slackToken} onChange={(e) => setSlackToken(e.target.value)} />
              <SaveButton onSave={async () => {
                await setSecret(SECRET_KEYS.slackBot, slackToken);
                if (slackToken.trim()) {
                  await upsertIntegration("slack", {});
                }
              }} />
            </div>
          </Field>
          <div className="mb-3">
            <Ghost onClick={loadSlackChannels}>
              {slackChannels.length > 0 ? "Reload" : "Load public channels"}
            </Ghost>
          </div>
          <ChipGrid label="Slack channels to read">
            {slackChannels.map((ch) => {
              const on = cfg.selected_slack_channels.some((c) => c.id === ch.id);
              return (
                <SourceChip
                  key={ch.id}
                  checked={on}
                  label={`#${ch.name}`}
                  onClick={async () => {
                    const next = on
                      ? cfg.selected_slack_channels.filter((c) => c.id !== ch.id)
                      : [...cfg.selected_slack_channels, { id: ch.id, name: ch.name }].slice(0, 10);
                    await setConfig({ selected_slack_channels: next });
                    setCfg({ ...cfg, selected_slack_channels: next });
                  }}
                />
              );
            })}
          </ChipGrid>
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
              <SaveButton onSave={async () => {
                await setSecret(SECRET_KEYS.github, ghToken);
                if (ghToken.trim()) {
                  await upsertIntegration("github", {});
                }
              }} />
            </div>
          </Field>
          <div className="mb-3">
            <Ghost onClick={loadGhRepos}>
              {ghRepos.length > 0 ? "Reload" : "Load my repos"}
            </Ghost>
          </div>
          <ChipGrid label="GitHub repos to read">
            {ghRepos.map((r) => {
              const [owner, repo] = r.full_name.split("/");
              const on = cfg.selected_github_repos.some((x) => x.owner === owner && x.repo === repo);
              return (
                <SourceChip
                  key={r.full_name}
                  checked={on}
                  label={r.full_name}
                  onClick={async () => {
                    const next = on
                      ? cfg.selected_github_repos.filter((x) => !(x.owner === owner && x.repo === repo))
                      : [...cfg.selected_github_repos, { owner, repo }];
                    await setConfig({ selected_github_repos: next });
                    setCfg({ ...cfg, selected_github_repos: next });
                  }}
                />
              );
            })}
          </ChipGrid>
        </Panel>

        <Panel title="GitLab">
          <Field
            label="Instance URL"
          >
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={glInstanceUrl}
                placeholder="https://gitlab.com"
                onChange={(e) => setGlInstanceUrl(e.target.value)}
              />
              <SaveButton onSave={async () => {
                const normalized = (glInstanceUrl || "https://gitlab.com").replace(/\/+$/, "");
                await setConfig({ gitlab_instance_url: normalized });
                setCfg({ ...cfg, gitlab_instance_url: normalized });
              }} />
            </div>
          </Field>
          <Field label="Personal access token">
            <div className="flex gap-2">
              <input
                type="password"
                className={inputCls}
                value={glToken}
                placeholder="glpat-…"
                onChange={(e) => setGlToken(e.target.value)}
              />
              <SaveButton onSave={async () => {
                await setSecret(SECRET_KEYS.gitlab, glToken);
                if (glToken.trim()) {
                  await upsertIntegration("gitlab", {});
                }
              }} />
              <Ghost onClick={() => openExternal(
                `${(glInstanceUrl || "https://gitlab.com").replace(/\/+$/, "")}/-/user_settings/personal_access_tokens?name=Keepr&scopes=read_api,read_user,read_repository`
              )}>Get token</Ghost>
            </div>
          </Field>
          <div className="mb-3">
            <Ghost onClick={loadGlProjects}>
              {glProjects.length > 0 ? "Reload" : "Load my projects"}
            </Ghost>
          </div>
          <ChipGrid label="GitLab projects to read">
            {glProjects.map((p) => {
              const on = (cfg.selected_gitlab_projects || []).some((x) => x.id === p.id);
              return (
                <SourceChip
                  key={p.id}
                  checked={on}
                  label={p.path_with_namespace}
                  onClick={async () => {
                    const current = cfg.selected_gitlab_projects || [];
                    const next = on
                      ? current.filter((x) => x.id !== p.id)
                      : [...current, { id: p.id, path_with_namespace: p.path_with_namespace }];
                    await setConfig({ selected_gitlab_projects: next });
                    setCfg({ ...cfg, selected_gitlab_projects: next });
                  }}
                />
              );
            })}
          </ChipGrid>
        </Panel>

        <Panel title="Jira">
          <Field label="Atlassian Cloud URL">
            <div className="flex gap-2">
              <input className={inputCls} value={jiraUrl} placeholder="https://your-org.atlassian.net" onChange={(e) => setJiraUrl(e.target.value)} />
              <SaveButton onSave={async () => { await setConfig({ jira_cloud_url: jiraUrl }); }} />
            </div>
          </Field>
          <Field label="Email">
            <input className={inputCls} value={jiraEmail} placeholder="you@company.com" onChange={(e) => setJiraEmail(e.target.value)} />
          </Field>
          <Field label="API token">
            <div className="flex gap-2">
              <input type="password" className={inputCls} value={jiraToken} placeholder="Jira API token" onChange={(e) => setJiraToken(e.target.value)} />
              <SaveButton onSave={async () => {
                await setSecret(SECRET_KEYS.jiraEmail, jiraEmail);
                await setSecret(SECRET_KEYS.jiraToken, jiraToken);
                await setConfig({ jira_cloud_url: jiraUrl });
                if (jiraEmail.trim() && jiraToken.trim()) {
                  await upsertIntegration("jira", { email: jiraEmail.trim() });
                }
              }} />
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
              <SaveButton onSave={async () => {
                await setSecret(SECRET_KEYS.linear, linearKey);
                if (linearKey.trim()) {
                  await upsertIntegration("linear", {});
                }
              }} />
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
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
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
                  <input
                    className={inputCls}
                    placeholder="GitLab username"
                    value={m.gitlab_username || ""}
                    onChange={(e) => setMembers(members.map((x) => x.id === m.id ? { ...x, gitlab_username: e.target.value } : x))}
                  />
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
                  <SlackUserPicker
                    value={m.slack_user_id || ""}
                    slackUsers={slackUsers}
                    slackUsersLoaded={slackUsersLoaded}
                    onLoadUsers={async () => {
                      if (slackUsersLoaded) return;
                      try {
                        const users = await slack.listUsers();
                        setSlackUsers(users);
                        setSlackUsersLoaded(true);
                      } catch (e: any) {
                        alert(`Could not load Slack users: ${e.message}`);
                      }
                    }}
                    onChange={(uid) => setMembers(members.map((x) => x.id === m.id ? { ...x, slack_user_id: uid || null } : x))}
                  />
                  <UserPicker
                    value={m.jira_username || ""}
                    placeholder="Select Jira user"
                    options={jiraUsers.map((u) => ({ value: u.displayName, label: u.displayName, detail: u.emailAddress }))}
                    loaded={jiraUsersLoaded}
                    onLoad={async () => {
                      if (jiraUsersLoaded) return;
                      try {
                        const firstProject = cfg.selected_jira_projects?.[0];
                        const users = firstProject
                          ? await jira.listProjectMembers(firstProject.key)
                          : [];
                        setJiraUsers(users);
                        setJiraUsersLoaded(true);
                      } catch (e: any) {
                        alert(`Could not load Jira users: ${e.message}`);
                      }
                    }}
                    onChange={(v) => setMembers(members.map((x) => x.id === m.id ? { ...x, jira_username: v || null } : x))}
                  />
                  <UserPicker
                    value={m.linear_username || ""}
                    placeholder="Select Linear user"
                    options={linearUsers.map((u) => ({ value: u.displayName || u.name, label: u.displayName || u.name, detail: u.email }))}
                    loaded={linearUsersLoaded}
                    onLoad={async () => {
                      if (linearUsersLoaded) return;
                      try {
                        const users = await linear.listOrgMembers();
                        setLinearUsers(users);
                        setLinearUsersLoaded(true);
                      } catch (e: any) {
                        alert(`Could not load Linear users: ${e.message}`);
                      }
                    }}
                    onChange={(v) => setMembers(members.map((x) => x.id === m.id ? { ...x, linear_username: v || null } : x))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <SaveButton onSave={async () => {
                    await upsertMember({
                      id: m.id,
                      display_name: m.display_name,
                      github_handle: m.github_handle,
                      gitlab_username: m.gitlab_username,
                      slack_user_id: m.slack_user_id,
                      jira_username: m.jira_username,
                      linear_username: m.linear_username,
                      slug: slugify(m.display_name),
                    });
                    await load();
                  }} />
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
          <RubricTextarea
            value={cfg.engineering_rubric || ""}
            onChange={(v) => setCfg({ ...cfg, engineering_rubric: v })}
            onSave={() =>
              setConfig({ engineering_rubric: cfg.engineering_rubric || null })
            }
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

        <Panel title="Experimental">
          <p className="mb-4 text-xs text-ink-faint">
            Toggle new features. All are enabled by default.
          </p>
          {(
            [
              ["evidence_cards", "Evidence cards", "Rich popover previews on citation hover"],
              ["citation_sync", "Citation scroll sync", "Side-by-side reading and evidence layout"],
              ["confidence", "Confidence indicators", "Evidence density dots on section headings"],
              ["timeline", "Timeline strip", "Activity visualization for 1:1 prep sessions"],
              ["followups", "Follow-up tracker", "Track and manage follow-ups from sessions"],
              ["team_heatmap", "Team heatmap", "Activity heatmap grid for team members"],
              ["thread_graph", "Thread graph", "Relationship graph between evidence items"],
            ] as const
          ).map(([key, label, desc]) => {
            const flags = cfg.feature_flags || DEFAULT_FEATURE_FLAGS;
            return (
              <label key={key} className="mb-3 flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={flags[key]}
                  onChange={async () => {
                    const next: FeatureFlags = { ...flags, [key]: !flags[key] };
                    await setConfig({ feature_flags: next });
                    setCfg({ ...cfg, feature_flags: next });
                  }}
                  className="mt-1 h-4 w-4 rounded border-hairline text-ink accent-ink"
                />
                <div>
                  <div className="text-xs font-medium text-ink">{label}</div>
                  <div className="text-[11px] text-ink-faint">{desc}</div>
                </div>
              </label>
            );
          })}
        </Panel>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-ghost focus:border-ink/40 focus:outline-none transition-colors duration-180";

const PANEL_ICONS: Record<string, React.ReactNode> = {
  Slack: <SlackIcon size={16} />,
  GitHub: <GitHubIcon size={16} />,
  GitLab: <GitLabIcon size={16} />,
  Jira: <JiraIcon size={16} />,
  Linear: <LinearIcon size={16} />,
  Model: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="4" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="5.5" cy="8" r="1" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="10.5" cy="8" r="1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M7 8h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  Experimental: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 2h4M7 2v4l-3.5 6a1 1 0 0 0 .87 1.5h7.26a1 1 0 0 0 .87-1.5L9 6V2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10h6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const icon = PANEL_ICONS[title];
  // Stable id anchor per integration panel so the RunOverlay "Fix in
  // Settings" button can scroll to the right one via focusKind.
  const anchor = `panel-${title.toLowerCase()}`;
  return (
    <section
      id={anchor}
      className="hair-b mb-10 pb-10 last:mb-0 last:pb-0 last:border-0 scroll-mt-16"
    >
      <div className="grid grid-cols-[180px_1fr] gap-10">
        <h2 className="flex items-center gap-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          {icon}
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

// Consistent save-state button. Replaces Ghost for every save action.
// Manages its own idle → saving → saved → error lifecycle. aria-live
// announces state changes to screen readers.
function SaveButton({
  onSave,
  label = "Save",
}: {
  onSave: () => Promise<void>;
  label?: string;
}) {
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  return (
    <button
      disabled={status === "saving"}
      onClick={async () => {
        setStatus("saving");
        try {
          await onSave();
          setStatus("saved");
          setTimeout(() => setStatus("idle"), 1800);
        } catch {
          setStatus("error");
          setTimeout(() => setStatus("idle"), 3000);
        }
      }}
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-xs transition-all duration-180 ease-calm ${
        status === "saved"
          ? "border-ink/20 text-ink-muted"
          : status === "error"
          ? "border-red-300 text-red-600"
          : "border-hairline text-ink-soft hover:border-ink/20 hover:text-ink"
      }`}
      aria-live="polite"
    >
      {status === "saving"
        ? "Saving\u2026"
        : status === "saved"
        ? "Saved"
        : status === "error"
        ? "Failed"
        : label}
    </button>
  );
}

// Slack user picker — loads workspace users on first focus, shows a select
// dropdown with human-readable names but stores the actual Slack user ID
// (e.g. U05RQAXHBL7). This eliminates the #1 matching failure: users
// entering display names instead of opaque user IDs.
function SlackUserPicker({
  value,
  slackUsers,
  slackUsersLoaded,
  onLoadUsers,
  onChange,
}: {
  value: string;
  slackUsers: slack.SlackUser[];
  slackUsersLoaded: boolean;
  onLoadUsers: () => Promise<void>;
  onChange: (uid: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleFocus = async () => {
    if (slackUsersLoaded || loading) return;
    setLoading(true);
    await onLoadUsers();
    setLoading(false);
  };

  // Show the selected user's name next to the dropdown for confirmation
  const selectedUser = slackUsers.find((u) => u.id === value);
  const label = selectedUser
    ? selectedUser.profile?.real_name || selectedUser.real_name || selectedUser.name
    : null;

  return (
    <div className="relative">
      <select
        className={inputCls + " appearance-none pr-7"}
        value={value}
        onFocus={handleFocus}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {loading ? "Loading users\u2026" : "Select Slack user"}
        </option>
        {/* If a value is set but users haven't loaded yet, show a placeholder option */}
        {value && !selectedUser && (
          <option value={value}>{value} (not resolved)</option>
        )}
        {slackUsers.map((u) => {
          const display = u.profile?.real_name || u.real_name || u.name;
          return (
            <option key={u.id} value={u.id}>
              {display} ({u.name})
            </option>
          );
        })}
      </select>
      {/* Dropdown chevron */}
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}

/** Generic user picker dropdown. Lazy-loads options on focus. */
function UserPicker({
  value,
  placeholder,
  options,
  loaded,
  onLoad,
  onChange,
}: {
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string; detail?: string }>;
  loaded: boolean;
  onLoad: () => Promise<void>;
  onChange: (v: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleFocus = async () => {
    if (loaded || loading) return;
    setLoading(true);
    await onLoad();
    setLoading(false);
  };

  return (
    <div className="relative">
      <select
        className={inputCls + " appearance-none pr-7"}
        value={value}
        onFocus={handleFocus}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {loading ? "Loading\u2026" : placeholder}
        </option>
        {value && !options.find((o) => o.value === value) && (
          <option value={value}>{value}</option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}{o.detail ? ` (${o.detail})` : ""}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}

// Thin wrapper around an input that auto-saves on blur and flashes
// "Saved" briefly. For model names, rubric text, and similar fields
// that don't need a manual Save button.
function AutoSaveInput({
  value,
  onChange,
  onSave,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onBlur"> & {
  onSave: () => Promise<void>;
}) {
  const [flash, setFlash] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        className={className}
        value={value}
        onChange={onChange}
        onBlur={async () => {
          try {
            await onSave();
            setFlash(true);
            setTimeout(() => setFlash(false), 1200);
          } catch {
            // silent — blur-save is best-effort
          }
        }}
      />
      <span
        className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint transition-opacity duration-300 ${
          flash ? "opacity-100" : "opacity-0"
        }`}
        aria-live="polite"
      >
        {flash ? "Saved" : ""}
      </span>
    </div>
  );
}

// Auto-save textarea with the same flash pattern. Used for the rubric.
function RubricTextarea({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => Promise<void>;
}) {
  const [flash, setFlash] = useState(false);
  return (
    <div className="relative">
      <textarea
        className={`${inputCls} min-h-[120px] resize-y font-mono text-xs`}
        value={value}
        placeholder={
          "# Engineering Ladder\n\n## L3 — Mid-level\n- Technical execution: ...\n- Collaboration: ...\n\n## L4 — Senior\n- Technical execution: ...\n- Collaboration: ..."
        }
        onChange={(e) => onChange(e.target.value)}
        onBlur={async () => {
          try {
            await onSave();
            setFlash(true);
            setTimeout(() => setFlash(false), 1200);
          } catch {
            // silent
          }
        }}
      />
      <span
        className={`pointer-events-none absolute right-2 bottom-3 text-[10px] text-ink-faint transition-opacity duration-300 ${
          flash ? "opacity-100" : "opacity-0"
        }`}
        aria-live="polite"
      >
        {flash ? "Saved" : ""}
      </span>
    </div>
  );
}

// ── Categorized provider row (Settings Model panel) ───────────────────

const CATEGORY_ORDER: LLMCategory[] = ["hosted", "cli", "self_hosted"];
const CATEGORY_LABELS: Record<LLMCategory, string> = {
  hosted: "Hosted",
  cli: "Local CLI",
  self_hosted: "Self-hosted",
};

/** Mirror of the onboarding categorized grid, sized for the Settings panel.
 *  Within each non-empty category, providers render as flex-1 buttons in a
 *  row. CategoryDivider sits between sections. Empty categories don't render
 *  their divider — relevant today because self_hosted is empty until Qwen
 *  Local lands. */
function CategorizedProviderRow({
  active,
  onPick,
}: {
  active: LLMProviderId;
  onPick: (id: LLMProviderId) => void;
}) {
  const groups = providersByCategory();
  const sections = CATEGORY_ORDER
    .map((cat) => ({ cat, providers: groups[cat] }))
    .filter((s) => s.providers.length > 0);

  return (
    <div className="mb-3">
      {sections.map((section, idx) => (
        <div key={section.cat}>
          {idx > 0 && <CategoryDivider label={CATEGORY_LABELS[section.cat]} />}
          <div className="flex gap-2">
            {section.providers.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p.id)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize transition-all duration-180 ease-calm ${
                  active === p.id
                    ? "border-ink/35 text-ink"
                    : "border-hairline text-ink-soft hover:border-ink/20"
                }`}
              >
                {p.id}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
