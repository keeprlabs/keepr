#!/usr/bin/env tsx
/**
 * Minimal, lightweight prompt eval harness.
 *
 * This script is deliberately NOT a regression test. It has no
 * assertions, no golden files, no CI gate. Its job is:
 *
 *   1. Load a hand-crafted evidence fixture from evals/fixtures/.
 *   2. Run the real Keepr prompt contract against it via a plain
 *      Anthropic LLMProvider (no Tauri, no DB, no memory files).
 *   3. Write the final markdown to evals/out/ so a human can diff
 *      it by eye and decide whether the prompts are still honest.
 *
 * It does NOT import src/services/pipeline.ts because that module
 * pulls in Tauri plugins that can't run under Node. Instead we
 * re-implement the minimal map -> reduce shape here, reading the
 * exact same prompt files from src/prompts/ so any edit to the
 * prompts is reflected immediately.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npm run eval -- team_pulse baseline
 *   npm run eval -- one_on_one_prep stretched_thin --target tm_3
 *   npm run eval -- --list
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---- Paths ---------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const PROMPTS_DIR = join(REPO_ROOT, "src", "prompts");
const FIXTURES_DIR = join(__dirname, "fixtures");
const OUT_DIR = join(__dirname, "out");

// ---- Types that mirror the production pipeline --------------------------

type WorkflowType = "team_pulse" | "one_on_one_prep";

interface EvidenceItem {
  id: string;
  source: string;
  actor_id: string | null;
  timestamp: string;
  content: string;
}

interface Fixture {
  description: string;
  workflow: WorkflowType;
  time_range: { start: string; end: string };
  team: Array<{ id: string; display_name: string }>;
  buckets: Record<string, EvidenceItem[]>;
}

// ---- Minimal LLMProvider ------------------------------------------------
//
// This mirrors the shape of `src/services/llm.ts`'s `LLMProvider`
// interface but uses plain Node `fetch` instead of the Tauri HTTP
// plugin. We only implement Anthropic — other providers can be added
// here if the harness ever needs to compare.

interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

interface LLMCallOptions {
  model: string;
  system?: string;
  messages: LLMMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface LLMCallResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
}

interface LLMProvider {
  id: string;
  complete(opts: LLMCallOptions): Promise<LLMCallResult>;
}

function makeAnthropicProvider(): LLMProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Export it before running: export ANTHROPIC_API_KEY=sk-ant-..."
    );
  }
  return {
    id: "anthropic",
    async complete(opts) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.max_tokens ?? 2000,
          temperature: opts.temperature ?? 0.2,
          system: opts.system,
          messages: opts.messages,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Anthropic ${res.status}: ${t.slice(0, 500)}`);
      }
      const data: any = await res.json();
      const text =
        (data.content || [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n") || "";
      return {
        text,
        input_tokens: data.usage?.input_tokens ?? 0,
        output_tokens: data.usage?.output_tokens ?? 0,
      };
    },
  };
}

// ---- Fixture loading ----------------------------------------------------

function listFixtures(): string[] {
  if (!existsSync(FIXTURES_DIR)) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

function loadFixture(name: string): Fixture {
  const path = join(FIXTURES_DIR, `${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Fixture not found: ${name}. Available: ${listFixtures().join(", ") || "(none)"}`
    );
  }
  return JSON.parse(readFileSync(path, "utf-8")) as Fixture;
}

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf-8");
}

// ---- Evidence JSON builder (mirrors pipeline.buildEvidenceJson) ---------

function buildEvidenceJson(
  fixture: Fixture,
  items: EvidenceItem[],
  workflow: WorkflowType
): string {
  return JSON.stringify(
    {
      workflow,
      time_range: fixture.time_range,
      team: fixture.team,
      evidence: items,
    },
    null,
    2
  );
}

// ---- Haiku map step -----------------------------------------------------

async function runMapStep(
  provider: LLMProvider,
  fixture: Fixture,
  workflow: WorkflowType,
  classifierModel: string
): Promise<{ summaries: string[]; tokens: { in: number; out: number } }> {
  const haikuPrompt = loadPrompt("haiku_channel_summary.md");
  const summaries: string[] = [];
  let totalIn = 0;
  let totalOut = 0;

  for (const [bucket, items] of Object.entries(fixture.buckets)) {
    if (!items.length) continue;
    const evidenceJson = buildEvidenceJson(fixture, items, workflow);
    process.stderr.write(`  [map] ${bucket} (${items.length} items)...\n`);
    const r = await provider.complete({
      model: classifierModel,
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
    totalIn += r.input_tokens;
    totalOut += r.output_tokens;
    const text = r.text.trim();
    if (text && text !== "Nothing notable.") {
      summaries.push(`### Source: ${bucket}\n\n${text}`);
    } else {
      process.stderr.write(`    (nothing notable)\n`);
    }
  }

  return { summaries, tokens: { in: totalIn, out: totalOut } };
}

// ---- Sonnet reduce step -------------------------------------------------

async function runReduceStep(
  provider: LLMProvider,
  fixture: Fixture,
  workflow: WorkflowType,
  synthesisModel: string,
  bucketSummaries: string[],
  memoryContext: string,
  target: { id: string; display_name: string } | null
): Promise<{ markdown: string; tokens: { in: number; out: number } }> {
  const systemPrompt = loadPrompt(
    workflow === "team_pulse" ? "team_pulse.md" : "one_on_one_prep.md"
  );

  const userBlock = [
    `# Memory context`,
    memoryContext || "first run — no prior context",
    ``,
    `# Team`,
    fixture.team.map((m) => `- {${m.id}} ${m.display_name}`).join("\n"),
    target ? `\n# Target engineer for 1:1\n- {${target.id}} ${target.display_name}` : "",
    ``,
    `# Time range`,
    `${fixture.time_range.start} → ${fixture.time_range.end}`,
    ``,
    `# Per-source summaries`,
    bucketSummaries.join("\n\n---\n\n"),
  ]
    .filter(Boolean)
    .join("\n");

  process.stderr.write(`  [reduce] synthesizing with ${synthesisModel}...\n`);
  const r = await provider.complete({
    model: synthesisModel,
    system: systemPrompt,
    messages: [{ role: "user", content: userBlock }],
    max_tokens: 3000,
    temperature: 0.25,
  });

  return {
    markdown: r.text.trim(),
    tokens: { in: r.input_tokens, out: r.output_tokens },
  };
}

// ---- Citation sanity check ----------------------------------------------
//
// Not an assertion — just a warning. Flags any [^ev_N] in the output
// that doesn't correspond to a real id in the fixture evidence.

function lintCitations(markdown: string, fixture: Fixture): string[] {
  const validIds = new Set<string>();
  for (const items of Object.values(fixture.buckets)) {
    for (const it of items) validIds.add(it.id);
  }
  const used = new Set<string>();
  const rx = /\[\^(ev_\w+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(markdown)) !== null) {
    used.add(m[1]);
  }
  const invented: string[] = [];
  for (const id of used) {
    if (!validIds.has(id)) invented.push(id);
  }
  return invented;
}

// ---- CLI ----------------------------------------------------------------

interface Args {
  workflow: WorkflowType | null;
  fixture: string | null;
  target: string | null;
  synthesisModel: string;
  classifierModel: string;
  memoryPath: string | null;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    workflow: null,
    fixture: null,
    target: null,
    synthesisModel: "claude-sonnet-4-5",
    classifierModel: "claude-haiku-4-5",
    memoryPath: null,
    list: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") args.list = true;
    else if (a === "--target") args.target = argv[++i];
    else if (a === "--synthesis-model") args.synthesisModel = argv[++i];
    else if (a === "--classifier-model") args.classifierModel = argv[++i];
    else if (a === "--memory") args.memoryPath = argv[++i];
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else positional.push(a);
  }
  if (positional[0] === "team_pulse" || positional[0] === "one_on_one_prep") {
    args.workflow = positional[0];
  } else if (positional[0]) {
    throw new Error(`Unknown workflow: ${positional[0]}. Use team_pulse or one_on_one_prep.`);
  }
  if (positional[1]) args.fixture = positional[1];
  return args;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  npm run eval -- team_pulse <fixture>",
      "  npm run eval -- one_on_one_prep <fixture> --target tm_N",
      "  npm run eval -- --list",
      "",
      "Optional flags:",
      "  --synthesis-model <id>   (default claude-sonnet-4-5)",
      "  --classifier-model <id>  (default claude-haiku-4-5)",
      "  --memory <path>          file whose contents become the memory block",
      "",
      `Fixtures: ${listFixtures().join(", ") || "(none found)"}`,
      "",
    ].join("\n")
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    process.stderr.write(`Fixtures in ${FIXTURES_DIR}:\n`);
    for (const f of listFixtures()) process.stderr.write(`  - ${f}\n`);
    return;
  }

  if (!args.workflow || !args.fixture) {
    printUsage();
    process.exit(1);
  }

  const fixture = loadFixture(args.fixture);
  const provider = makeAnthropicProvider();

  let target: { id: string; display_name: string } | null = null;
  if (args.workflow === "one_on_one_prep") {
    if (!args.target) {
      throw new Error("--target tm_N is required for one_on_one_prep");
    }
    const t = fixture.team.find((m) => m.id === args.target);
    if (!t) {
      throw new Error(
        `Target ${args.target} not found in fixture. Team: ${fixture.team.map((m) => m.id).join(", ")}`
      );
    }
    target = t;
  }

  let memoryContext = "first run — no prior context";
  if (args.memoryPath) {
    memoryContext = readFileSync(args.memoryPath, "utf-8");
  }

  process.stderr.write(
    `\nRunning ${args.workflow} on fixture "${args.fixture}"\n` +
      `  description: ${fixture.description}\n` +
      `  synthesis:  ${args.synthesisModel}\n` +
      `  classifier: ${args.classifierModel}\n` +
      (target ? `  target:     ${target.id} (${target.display_name})\n` : "") +
      `  memory:     ${args.memoryPath || "(first run)"}\n\n`
  );

  const map = await runMapStep(provider, fixture, args.workflow, args.classifierModel);
  if (!map.summaries.length) {
    process.stderr.write(
      "WARNING: no bucket summaries produced. Reduce step will run on an empty input.\n"
    );
  }

  const reduce = await runReduceStep(
    provider,
    fixture,
    args.workflow,
    args.synthesisModel,
    map.summaries,
    memoryContext,
    target
  );

  const invented = lintCitations(reduce.markdown, fixture);
  if (invented.length) {
    process.stderr.write(
      `\nWARNING: output cites ${invented.length} id(s) not present in the fixture: ${invented.join(", ")}\n`
    );
  }

  const totalIn = map.tokens.in + reduce.tokens.in;
  const totalOut = map.tokens.out + reduce.tokens.out;
  const cost = (totalIn / 1_000_000) * 3 + (totalOut / 1_000_000) * 15;

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${args.fixture}-${args.workflow}${target ? `-${target.id}` : ""}-${stamp}`;
  const mdPath = join(OUT_DIR, `${base}.md`);
  const bucketsPath = join(OUT_DIR, `${base}.buckets.md`);

  const header = [
    `<!--`,
    `  fixture:    ${args.fixture}`,
    `  workflow:   ${args.workflow}`,
    target ? `  target:     ${target.id} (${target.display_name})` : null,
    `  synthesis:  ${args.synthesisModel}`,
    `  classifier: ${args.classifierModel}`,
    `  memory:     ${args.memoryPath || "(first run)"}`,
    `  tokens:     in=${totalIn} out=${totalOut} cost≈$${cost.toFixed(4)}`,
    invented.length ? `  WARNING:    invented ids: ${invented.join(", ")}` : null,
    `-->`,
    ``,
  ]
    .filter(Boolean)
    .join("\n");

  writeFileSync(mdPath, header + reduce.markdown + "\n");
  writeFileSync(
    bucketsPath,
    `# Per-bucket Haiku summaries — ${args.fixture}\n\n${map.summaries.join("\n\n---\n\n")}\n`
  );

  process.stderr.write(`\nWrote:\n  ${mdPath}\n  ${bucketsPath}\n`);
  process.stderr.write(
    `Tokens: in=${totalIn} out=${totalOut} cost≈$${cost.toFixed(4)}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`\nERROR: ${err.message || err}\n`);
  process.exit(1);
});
