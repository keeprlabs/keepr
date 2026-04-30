// Demo mode — "Try with sample data" path.
//
// The goal: let an OAuth-averse EM evaluate Keepr's real output quality in
// under two minutes, without giving up their Slack bot token or GitHub PAT.
// They still provide an LLM key, because the whole point is the synthesis.
//
// Architectural shape:
//   - A persistent flag (`app_config.demo_mode`) tells the app it's live in
//     demo mode. The normal onboarded_at flag still gets set so the main
//     shell boots.
//   - `seedDemoData()` writes the synthetic team members and selects empty
//     Slack/GitHub integration metadata so the pipeline's real fetchers are
//     never invoked in demo mode.
//   - `runDemoWorkflow()` is a thin parallel to `pipeline.runWorkflow`. It
//     builds `NormalizedItem`s from fixtures and then runs the exact same
//     map -> reduce LLM shape as the real pipeline, using the same prompts
//     and provider. This deliberately does NOT modify pipeline.ts — demo
//     mode is additive.
//   - `exitDemoMode()` wipes the demo members, sessions, evidence, memory
//     directory selection, and the flag itself — returning the user to a
//     clean pre-onboarding state so they can wire real data.

import { join } from "@tauri-apps/api/path";
import teamPulsePrompt from "../prompts/team_pulse.md?raw";
import onePrepPrompt from "../prompts/one_on_one_prep.md?raw";
import weeklyUpdatePrompt from "../prompts/weekly_eng_update.md?raw";
import perfEvalPrompt from "../prompts/perf_evaluation.md?raw";
import promoReadyPrompt from "../prompts/promo_readiness.md?raw";
import haikuPrompt from "../prompts/haiku_channel_summary.md?raw";

import {
  createSession,
  db,
  getConfig,
  insertEvidence,
  insertPersonFacts,
  listMembers,
  setConfig,
  setSessionStatus,
  updateSession,
  upsertIntegration,
  upsertMember,
} from "./db";
import { defaultMemoryDir, ensureDir } from "./fsio";
import { getProvider } from "./llm";
import { slugify, writeMemory, dualWriteEvidenceBatch } from "./memory";
import { evidenceSubjectFor } from "./ctxSubjects";
import type {
  EvidencePromptItem,
  EvidenceSource,
  TeamMember,
  WorkflowType,
} from "../lib/types";

import {
  DEMO_MEMBERS,
  DEMO_PRS,
  DEMO_MRS,
  DEMO_SLACK_MESSAGES,
  DEMO_JIRA_ISSUES,
  DEMO_LINEAR_ISSUES,
  type DemoSlackMsg,
} from "../demo/fixtures";

// ---- Mode flag -----------------------------------------------------------
//
// The demo flag lives inside app_config so it survives restarts and so
// Settings / About screens can read it through the same surface as every
// other config value.

export async function isDemoMode(): Promise<boolean> {
  const cfg = (await getConfig()) as any;
  return Boolean(cfg.demo_mode);
}

export async function setDemoMode(on: boolean): Promise<void> {
  await setConfig({ demo_mode: on } as any);
}

// ---- Seed / unseed -------------------------------------------------------

export async function seedDemoData(): Promise<void> {
  // Demo memory directory is a sibling of the real one — we never touch
  // ~/Documents/Keepr during a demo so the user's real notes (if any) are
  // untouched.
  const realDefault = await defaultMemoryDir();
  const demoDir = realDefault.replace(/\/Keepr$/, "/Keepr-Demo");
  await ensureDir(demoDir);

  await setConfig({
    memory_dir: demoDir,
    // The pipeline's real fetchers read these lists — empty means "nothing
    // to fetch", which is exactly right: the demo pipeline never calls
    // fetchRepoActivity or fetchChannelHistory.
    selected_slack_channels: [],
    selected_github_repos: [],
    selected_gitlab_projects: [],
    demo_mode: true,
  } as any);

  // Mark slack + github integrations as "active" with a demo marker so the
  // sidebar status dots are green and the shell doesn't nag the user to
  // connect things.
  await upsertIntegration("slack", { demo: true, team: "Acme (demo)" });
  await upsertIntegration("github", { demo: true, login: "acme-demo" });
  await upsertIntegration("gitlab", { demo: true, login: "acme-demo" });
  await upsertIntegration("jira", { demo: true, site: "acme-demo.atlassian.net" });
  await upsertIntegration("linear", { demo: true, org: "Acme (demo)" });

  // Insert the synthetic team. If any of these already exist (user ran
  // the demo twice), upsertMember via slug dedupe happens downstream — but
  // the current `upsertMember` inserts by name, so we check existing first.
  const existing = await listMembers();
  const bySlug = new Map(existing.map((m) => [m.slug, m]));
  for (const d of DEMO_MEMBERS) {
    if (bySlug.has(d.slug)) continue;
    await upsertMember({
      display_name: d.display_name,
      github_handle: d.github_handle,
      gitlab_username: d.gitlab_username,
      slack_user_id: d.slack_user_id,
      slug: d.slug,
    });
  }

  await setConfig({
    privacy_consent_at: new Date().toISOString(),
    onboarded_at: new Date().toISOString(),
  });
}

export async function exitDemoMode(): Promise<void> {
  // Wipe everything that originated from demo mode. We keep the LLM key
  // and provider selection — the whole point of "switch to real data" is
  // that the user already proved the LLM works for them.
  const d = await db();

  await d.execute(
    "DELETE FROM evidence_items WHERE session_id IN (SELECT id FROM sessions)"
  );
  await d.execute(
    "DELETE FROM person_facts WHERE session_id IN (SELECT id FROM sessions)"
  );
  await d.execute("DELETE FROM query_history");
  await d.execute("DELETE FROM sessions");

  // Demo team members are identified by their demo slack_user_id prefix.
  await d.execute(
    "DELETE FROM team_members WHERE slack_user_id LIKE 'U0DEMO%'"
  );

  await d.execute("DELETE FROM integrations WHERE provider IN ('slack','github','gitlab','jira','linear')");

  await setConfig({
    demo_mode: false,
    onboarded_at: null,
    privacy_consent_at: null,
    selected_slack_channels: [],
    selected_github_repos: [],
    selected_gitlab_projects: [],
    memory_dir: "",
  } as any);
}

// ---- Pipeline parallel ---------------------------------------------------
//
// This is deliberately a parallel to pipeline.runWorkflow, not a call into
// it. It shares the prompts and the provider, so the output quality is
// identical to the real thing — the only difference is where the evidence
// comes from.

interface NormalizedItem {
  source: EvidenceSource;
  source_id: string;
  source_url: string;
  timestamp_at: string;
  content: string;
  actor_slack: string | null;
  actor_github: string | null;
  actor_gitlab: string | null;
  bucket: string;
}

function hoursAgoToIso(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

function fabricateSlackUrl(channel_id: string, ts: string): string {
  return `https://acme-demo.slack.com/archives/${channel_id}/p${ts.replace(".", "")}`;
}

function buildDemoEvidence(members: TeamMember[]): NormalizedItem[] {
  // Map seed_id -> (slack_user_id, github_handle) through the real members
  // we just inserted, so the pipeline's actor resolution works unchanged.
  const bySlug = new Map(members.map((m) => [m.slug, m]));
  const lookupBySeed = (seed: string) => {
    const d = DEMO_MEMBERS.find((x) => x.seed_id === seed);
    if (!d) return null;
    return bySlug.get(d.slug) || null;
  };

  const out: NormalizedItem[] = [];

  // ---- Slack ----
  const pushSlack = (m: DemoSlackMsg, parent?: DemoSlackMsg) => {
    const author = lookupBySeed(m.author);
    const ts = (Date.now() / 1000 - m.hours_ago * 3600).toFixed(6);
    const url = fabricateSlackUrl(m.channel_id, ts);
    const prefix = parent ? `#${m.channel_name} (thread)` : `#${m.channel_name}`;
    out.push({
      source: "slack_message",
      source_id: `${m.channel_id}:${ts}`,
      source_url: url,
      timestamp_at: hoursAgoToIso(m.hours_ago),
      content: `${prefix}: ${m.text}`,
      actor_slack: author?.slack_user_id ?? null,
      actor_github: null,
      actor_gitlab: null,
      bucket: `slack:${m.channel_name}`,
    });
  };

  for (const msg of DEMO_SLACK_MESSAGES) {
    pushSlack(msg);
    for (const r of msg.replies || []) {
      pushSlack(
        {
          channel_id: msg.channel_id,
          channel_name: msg.channel_name,
          hours_ago: r.hours_ago,
          author: r.author,
          text: r.text,
        },
        msg
      );
    }
  }

  // ---- GitHub ----
  for (const pr of DEMO_PRS) {
    const author = lookupBySeed(pr.author);
    const prUrl = `https://github.com/${pr.repo}/pull/${pr.number}`;
    out.push({
      source: "github_pr",
      source_id: `${pr.repo}#${pr.number}`,
      source_url: prUrl,
      timestamp_at: hoursAgoToIso(pr.hours_ago),
      content: `PR ${pr.repo}#${pr.number}: ${pr.title}\n\n${pr.body}`.trim(),
      actor_slack: null,
      actor_github: author?.github_handle ?? null,
      actor_gitlab: null,
      bucket: `repo:${pr.repo}`,
    });
    for (const rv of pr.reviews) {
      const rvAuthor = lookupBySeed(rv.author);
      if (!rv.body.trim()) continue;
      out.push({
        source: "github_review",
        source_id: `${pr.repo}#${pr.number}:review:${rv.author}:${rv.hours_ago}`,
        source_url: `${prUrl}#pullrequestreview`,
        timestamp_at: hoursAgoToIso(rv.hours_ago),
        content: `Review on ${pr.repo}#${pr.number} (${rv.state}): ${rv.body}`,
        actor_slack: null,
        actor_github: rvAuthor?.github_handle ?? null,
        actor_gitlab: null,
        bucket: `repo:${pr.repo}`,
      });
    }
  }

  // ---- GitLab ----
  for (const mr of DEMO_MRS) {
    const author = lookupBySeed(mr.author) as any;
    const mrUrl = `https://gitlab.com/${mr.project}/-/merge_requests/${mr.iid}`;
    out.push({
      source: "gitlab_mr",
      source_id: `${mr.project}!${mr.iid}`,
      source_url: mrUrl,
      timestamp_at: hoursAgoToIso(mr.hours_ago),
      content: `MR ${mr.project}!${mr.iid}: ${mr.title}\n\n${mr.body}`.trim(),
      actor_slack: null,
      actor_github: null,
      actor_gitlab: author?.gitlab_username ?? null,
      bucket: `project:${mr.project}`,
    });
    for (const rv of mr.reviews) {
      const rvAuthor = lookupBySeed(rv.author) as any;
      const contentBody = rv.body.trim() || "(approved)";
      out.push({
        source: "gitlab_review",
        source_id: `${mr.project}!${mr.iid}:review:${rv.author}:${rv.hours_ago}`,
        source_url: `${mrUrl}#note_${rv.hours_ago}`,
        timestamp_at: hoursAgoToIso(rv.hours_ago),
        content: `Review on ${mr.project}!${mr.iid} (${rv.state}): ${contentBody}`,
        actor_slack: null,
        actor_github: null,
        actor_gitlab: rvAuthor?.gitlab_username ?? null,
        bucket: `project:${mr.project}`,
      });
    }
  }

  // ---- Jira ----
  for (const issue of DEMO_JIRA_ISSUES) {
    const assignee = lookupBySeed(issue.assignee);
    const issueUrl = `https://acme-demo.atlassian.net/browse/${issue.issue_key}`;
    out.push({
      source: "jira_issue",
      source_id: issue.issue_key,
      source_url: issueUrl,
      timestamp_at: hoursAgoToIso(issue.hours_ago),
      content: `${issue.issue_key}: ${issue.summary} [${issue.status}]\n\n${issue.description}`.trim(),
      actor_slack: null,
      actor_github: assignee?.github_handle ?? null,
      actor_gitlab: null,
      bucket: `jira:${issue.project_key}`,
    });
    for (const c of issue.comments) {
      const cAuthor = lookupBySeed(c.author);
      out.push({
        source: "jira_comment",
        source_id: `${issue.issue_key}:comment:${c.author}:${c.hours_ago}`,
        source_url: issueUrl,
        timestamp_at: hoursAgoToIso(c.hours_ago),
        content: `Comment on ${issue.issue_key}: ${c.body}`,
        actor_slack: cAuthor?.slack_user_id ?? null,
        actor_github: cAuthor?.github_handle ?? null,
        actor_gitlab: null,
        bucket: `jira:${issue.project_key}`,
      });
    }
  }

  // ---- Linear ----
  for (const issue of DEMO_LINEAR_ISSUES) {
    const assignee = lookupBySeed(issue.assignee);
    const issueUrl = `https://linear.app/acme-demo/issue/${issue.issue_id}`;
    out.push({
      source: "linear_issue",
      source_id: issue.issue_id,
      source_url: issueUrl,
      timestamp_at: hoursAgoToIso(issue.hours_ago),
      content: `${issue.issue_id}: ${issue.title} [${issue.state}] [${issue.priority}]\n\n${issue.description}`.trim(),
      actor_slack: null,
      actor_github: assignee?.github_handle ?? null,
      actor_gitlab: null,
      bucket: `linear:${issue.team_key}`,
    });
    for (const c of issue.comments) {
      const cAuthor = lookupBySeed(c.author);
      out.push({
        source: "linear_comment",
        source_id: `${issue.issue_id}:comment:${c.author}:${c.hours_ago}`,
        source_url: issueUrl,
        timestamp_at: hoursAgoToIso(c.hours_ago),
        content: `Comment on ${issue.issue_id}: ${c.body}`,
        actor_slack: cAuthor?.slack_user_id ?? null,
        actor_github: cAuthor?.github_handle ?? null,
        actor_gitlab: null,
        bucket: `linear:${issue.team_key}`,
      });
    }
  }

  return out;
}

function resolveActor(it: NormalizedItem, members: TeamMember[]): TeamMember | null {
  if (it.actor_github) {
    const m = members.find(
      (x) => (x.github_handle || "").toLowerCase() === it.actor_github!.toLowerCase()
    );
    if (m) return m;
  }
  if (it.actor_gitlab) {
    const m = members.find(
      (x) => (x.gitlab_username || "").toLowerCase() === it.actor_gitlab!.toLowerCase()
    );
    if (m) return m;
  }
  if (it.actor_slack) {
    const m = members.find((x) => x.slack_user_id === it.actor_slack);
    if (m) return m;
  }
  return null;
}

function mentionedTarget(it: NormalizedItem, target: TeamMember): boolean {
  if (!target.slack_user_id) return false;
  return it.content.includes(`<@${target.slack_user_id}>`);
}

function buildEvidenceJson(
  items: Array<{ idNum: number; actor: TeamMember | null; item: NormalizedItem }>,
  members: TeamMember[],
  timeRange: { start: string; end: string },
  workflow: WorkflowType
): string {
  const evidence: EvidencePromptItem[] = items.map(({ idNum, actor, item }) => ({
    id: `ev_${idNum}`,
    source: item.source,
    actor_id: actor ? `tm_${actor.id}` : null,
    timestamp: item.timestamp_at,
    url: item.source_url,
    content: item.content,
  }));
  return JSON.stringify(
    {
      workflow,
      time_range: timeRange,
      team: members.map((m) => ({ id: `tm_${m.id}`, display_name: m.display_name })),
      evidence,
    },
    null,
    2
  );
}

export interface DemoRunOptions {
  workflow: WorkflowType;
  targetMemberId?: number | null;
  daysBack: number;
  onProgress?: (stage: string, detail?: string) => void;
  // Accepted for API parity with RunOptions so App.tsx can pass the same
  // args into either runner. Demo runs are instant (fixtures), so the
  // signal is never actually checked — cancelling during demo mode has
  // no observable effect.
  signal?: AbortSignal;
}

export interface DemoRunResult {
  sessionId: number;
  outputPath: string;
  markdown: string;
  costUsd: number;
}

// Demo always returns PulseOutcome.ready — fixture data is guaranteed
// non-empty, so the empty/partial/total paths can't fire here. Wrapping
// keeps the runner type compatible with runWorkflow.
import type { PulseOutcome } from "./pulseOutcome";

export async function runDemoWorkflow(
  opts: DemoRunOptions
): Promise<PulseOutcome> {
  const progress = opts.onProgress || (() => {});
  const cfg = await getConfig();
  const members = await listMembers();

  // Demo mode uses "now" and a 7-day window; the fixture timestamps are
  // relative-to-now so the brief always reads like the week that just
  // happened.
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
  const timeRange = { start: start.toISOString(), end: end.toISOString() };

  const needsTarget = ["one_on_one_prep", "perf_evaluation", "promo_readiness"].includes(opts.workflow);
  const target =
    needsTarget && opts.targetMemberId
      ? members.find((m) => m.id === opts.targetMemberId) || null
      : null;

  const sessionId = await createSession({
    workflow_type: opts.workflow,
    target_member_id: target?.id ?? null,
    time_range_start: timeRange.start,
    time_range_end: timeRange.end,
  });

  try {
    await setSessionStatus(sessionId, "processing");

    progress("fetch", "Loading sample data");
    const all = buildDemoEvidence(members);

    // Same filter logic the real pipeline uses.
    const filtered = all.filter((it) => {
      const actor = resolveActor(it, members);
      if (needsTarget && target) {
        return actor?.id === target.id || mentionedTarget(it, target);
      }
      return actor != null;
    });

    if (!filtered.length) {
      throw new Error(
        "No sample activity matched that filter — try team pulse instead of a 1:1."
      );
    }

    const withIds = filtered.map((item, i) => ({
      idNum: i + 1,
      actor: resolveActor(item, members),
      item,
    }));

    const evidenceRows = withIds.map(({ item, actor }) => ({
      source: item.source,
      source_url: item.source_url,
      source_id: item.source_id,
      actor_member_id: actor?.id ?? null,
      timestamp_at: item.timestamp_at,
      content: item.content,
      subject_path: evidenceSubjectFor(item.source, item.source_id, item.source_url),
    }));
    await insertEvidence(sessionId, evidenceRows);

    // Mirror the real pipeline: dual-write evidence into ctxd so demo
    // users see populated MemorySearch / cmd+k results after a pulse.
    void dualWriteEvidenceBatch(evidenceRows).catch((err) => {
      console.warn(
        "[keepr] demo evidence dual-write failed:",
        err instanceof Error ? err.message : String(err)
      );
    });

    const buckets = new Map<string, typeof withIds>();
    for (const w of withIds) {
      const arr = buckets.get(w.item.bucket) || [];
      arr.push(w);
      buckets.set(w.item.bucket, arr);
    }

    const provider = getProvider(cfg.llm_provider);
    progress("map", `Summarizing ${buckets.size} sources`);

    let totalInput = 0;
    let totalOutput = 0;
    let haikuFailed = false;
    const bucketSummaries: string[] = [];

    for (const [bucket, arr] of buckets) {
      const evidenceJson = buildEvidenceJson(arr, members, timeRange, opts.workflow);
      try {
        const r = await provider.complete({
          model: cfg.classifier_model,
          system: haikuPrompt,
          messages: [
            {
              role: "user",
              content: `Source bucket: ${bucket}\n\nEvidence JSON:\n\`\`\`json\n${evidenceJson}\n\`\`\``,
            },
          ],
          max_tokens: 600,
          temperature: 0.1,
        });
        totalInput += r.input_tokens;
        totalOutput += r.output_tokens;
        const text = r.text.trim();
        if (text && text !== "Nothing notable.") {
          bucketSummaries.push(`### Source: ${bucket}\n\n${text}`);
        }
      } catch (err) {
        console.warn("demo haiku map failed for bucket", bucket, err);
        haikuFailed = true;
      }
    }

    // ---- Fact extraction (same logic as the real pipeline) ----
    for (const [bucket, arr] of buckets) {
      try {
        const evidenceJson = buildEvidenceJson(arr, members, timeRange, opts.workflow);
        const factPrompt = `Extract 2-5 structured facts about specific people from this evidence. Return ONLY valid JSON. Format: {"facts": [{"member_name": "Name", "fact_type": "shipped|reviewed|discussed|blocked|collaborated|led", "summary": "One-line summary", "evidence_ids": ["ev_1", "ev_2"]}]}`;
        const factResult = await provider.complete({
          model: cfg.classifier_model,
          system: factPrompt,
          messages: [
            {
              role: "user",
              content: `Source bucket: ${bucket}\n\nEvidence JSON:\n\`\`\`json\n${evidenceJson}\n\`\`\``,
            },
          ],
          max_tokens: 600,
          temperature: 0.1,
        });
        totalInput += factResult.input_tokens;
        totalOutput += factResult.output_tokens;

        let parsed: { facts: Array<{ member_name: string; fact_type: string; summary: string; evidence_ids: string[] }> } | null = null;
        try {
          parsed = JSON.parse(factResult.text.trim());
        } catch {
          const match = factResult.text.match(/\{[\s\S]*"facts"[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch { /* skip */ }
          }
        }

        if (parsed?.facts?.length) {
          const resolvedFacts: Array<{ member_id: number; fact_type: string; summary: string; evidence_ids: number[] }> = [];
          for (const fact of parsed.facts) {
            const nameLow = (fact.member_name || "").toLowerCase();
            const member = members.find(
              (m) =>
                m.display_name.toLowerCase() === nameLow ||
                (m.github_handle || "").toLowerCase() === nameLow ||
                (m.slack_user_id || "").toLowerCase() === nameLow
            );
            if (!member) continue;
            const evidenceIds = (fact.evidence_ids || [])
              .map((e) => parseInt(String(e).replace(/^ev_/, ""), 10))
              .filter((n) => !isNaN(n));
            resolvedFacts.push({
              member_id: member.id,
              fact_type: fact.fact_type,
              summary: fact.summary,
              evidence_ids: evidenceIds,
            });
          }
          if (resolvedFacts.length > 0) {
            await insertPersonFacts(sessionId, resolvedFacts);
          }
        }
      } catch (err) {
        console.warn("[keepr] demo fact extraction failed for bucket", bucket, err);
      }
    }

    let synthesisInput: string;
    if (!bucketSummaries.length || haikuFailed) {
      progress("synthesize", "Haiku fallback — sending raw evidence");
      synthesisInput = `NOTE: Haiku summarization unavailable, raw evidence follows.\n\n${buildEvidenceJson(
        withIds,
        members,
        timeRange,
        opts.workflow
      )}`;
      await updateSession(sessionId, {
        error_message: "demo: haiku_fallback used",
      });
    } else {
      synthesisInput = bucketSummaries.join("\n\n---\n\n");
    }

    progress("synthesize", "Synthesizing the brief");
    const systemPrompt =
      opts.workflow === "team_pulse" ? teamPulsePrompt
      : opts.workflow === "weekly_update" ? weeklyUpdatePrompt
      : opts.workflow === "perf_evaluation" ? perfEvalPrompt
      : opts.workflow === "promo_readiness" ? promoReadyPrompt
      : onePrepPrompt;

    const userBlock = [
      `# Memory context`,
      "first run (demo) — no prior context",
      ``,
      `# Team`,
      members
        .map(
          (m) =>
            `- {tm_${m.id}} ${m.display_name}${m.github_handle ? ` (@${m.github_handle})` : ""}`
        )
        .join("\n"),
      target
        ? `\n# Target engineer for 1:1\n- {tm_${target.id}} ${target.display_name}`
        : "",
      ``,
      `# Time range`,
      `${timeRange.start} → ${timeRange.end}`,
      ``,
      `# Per-source summaries`,
      synthesisInput,
    ]
      .filter(Boolean)
      .join("\n");

    const synth = await provider.complete({
      model: cfg.synthesis_model,
      system: systemPrompt,
      messages: [{ role: "user", content: userBlock }],
      max_tokens: (opts.workflow === "perf_evaluation" || opts.workflow === "promo_readiness") ? 5000 : 3000,
      temperature: 0.25,
    });
    totalInput += synth.input_tokens;
    totalOutput += synth.output_tokens;

    const markdown = synth.text.trim();

    progress("write", "Writing session + memory files");
    const outputPath = await writeMemory({
      memoryDir: cfg.memory_dir,
      workflow: opts.workflow,
      targetSlug: target?.slug ?? null,
      targetDisplayName: target?.display_name ?? null,
      members,
      markdown,
      evidence: withIds.map(({ idNum, item, actor }) => ({
        id: `ev_${idNum}`,
        source: item.source,
        url: item.source_url,
        actor_display: actor?.display_name ?? null,
        timestamp: item.timestamp_at,
        content: item.content,
      })),
      timeRange,
    });

    const costUsd =
      (totalInput / 1_000_000) * 3 + (totalOutput / 1_000_000) * 15;

    await updateSession(sessionId, {
      output_file_path: outputPath,
      token_usage: JSON.stringify({
        input: totalInput,
        output: totalOutput,
        cost_usd: Number(costUsd.toFixed(4)),
      }),
    });
    await setSessionStatus(sessionId, "complete");

    return {
      kind: "ready",
      sessionId,
      outputPath,
      markdown,
      costUsd,
      sources: [],
      windowDays: 7,
    };
  } catch (err: any) {
    console.error("demo pipeline failed", err);
    await setSessionStatus(sessionId, "failed", err?.message || String(err));
    throw err;
  }
}

// We purposefully re-use the path helper so code callers don't have to
// care about where the fixtures are mounted.
export async function demoMemoryDir(): Promise<string> {
  const realDefault = await defaultMemoryDir();
  return join(realDefault, "..", "Keepr-Demo");
}
