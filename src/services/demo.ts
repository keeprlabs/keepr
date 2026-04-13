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
import haikuPrompt from "../prompts/haiku_channel_summary.md?raw";

import {
  createSession,
  db,
  getConfig,
  insertEvidence,
  listMembers,
  setConfig,
  setSessionStatus,
  updateSession,
  upsertIntegration,
  upsertMember,
} from "./db";
import { defaultMemoryDir, ensureDir } from "./fsio";
import { getProvider } from "./llm";
import { slugify, writeMemory } from "./memory";
import type {
  EvidencePromptItem,
  EvidenceSource,
  TeamMember,
  WorkflowType,
} from "../lib/types";

import {
  DEMO_MEMBERS,
  DEMO_PRS,
  DEMO_SLACK_MESSAGES,
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
    demo_mode: true,
  } as any);

  // Mark slack + github integrations as "active" with a demo marker so the
  // sidebar status dots are green and the shell doesn't nag the user to
  // connect things.
  await upsertIntegration("slack", { demo: true, team: "Acme (demo)" });
  await upsertIntegration("github", { demo: true, login: "acme-demo" });

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
  await d.execute("DELETE FROM sessions");

  // Demo team members are identified by their demo slack_user_id prefix.
  await d.execute(
    "DELETE FROM team_members WHERE slack_user_id LIKE 'U0DEMO%'"
  );

  await d.execute("DELETE FROM integrations WHERE provider IN ('slack','github')");

  await setConfig({
    demo_mode: false,
    onboarded_at: null,
    privacy_consent_at: null,
    selected_slack_channels: [],
    selected_github_repos: [],
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
        bucket: `repo:${pr.repo}`,
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
}

export interface DemoRunResult {
  sessionId: number;
  outputPath: string;
  markdown: string;
  costUsd: number;
}

export async function runDemoWorkflow(
  opts: DemoRunOptions
): Promise<DemoRunResult> {
  const progress = opts.onProgress || (() => {});
  const cfg = await getConfig();
  const members = await listMembers();

  // Demo mode uses "now" and a 7-day window; the fixture timestamps are
  // relative-to-now so the brief always reads like the week that just
  // happened.
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
  const timeRange = { start: start.toISOString(), end: end.toISOString() };

  const target =
    opts.workflow === "one_on_one_prep" && opts.targetMemberId
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
      if (opts.workflow === "one_on_one_prep" && target) {
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

    await insertEvidence(
      sessionId,
      withIds.map(({ item, actor }) => ({
        source: item.source,
        source_url: item.source_url,
        source_id: item.source_id,
        actor_member_id: actor?.id ?? null,
        timestamp_at: item.timestamp_at,
        content: item.content,
      }))
    );

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
      opts.workflow === "team_pulse" ? teamPulsePrompt : onePrepPrompt;

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
      max_tokens: 3000,
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

    return { sessionId, outputPath, markdown, costUsd };
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
