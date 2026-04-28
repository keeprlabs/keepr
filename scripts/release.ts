#!/usr/bin/env tsx
// Keepr release script. Bumps version in the three sources of truth,
// runs the gate (typecheck + tests + build + cargo), opens CHANGES.md
// for the release notes, commits, tags, and pushes — which triggers
// .github/workflows/release.yml to build the DMG and update the
// homebrew tap.
//
// Usage:
//   npm run release 0.2.5         # explicit version
//   npm run release patch         # 0.2.4 → 0.2.5
//   npm run release minor         # 0.2.4 → 0.3.0
//   npm run release major         # 0.2.4 → 1.0.0
//
// Flags:
//   --yes / -y    skip the push confirmation prompt
//   --force       allow running off main (dangerous)
//
// The gate is non-skippable by design. A release script that lets you
// skip verification is a release script that ships broken builds.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");

// ── helpers ──────────────────────────────────────────────────────────────

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function run(cmd: string, opts: { cwd?: string } = {}): void {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: opts.cwd ?? ROOT, stdio: "inherit" });
}

function capture(cmd: string, opts: { cwd?: string } = {}): string {
  return execSync(cmd, { cwd: opts.cwd ?? ROOT, encoding: "utf8" }).trim();
}

function isSemver(s: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(s);
}

function bump(version: string, kind: "patch" | "minor" | "major"): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) fail(`Cannot parse version: ${version}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function compareSemver(a: string, b: string): number {
  const [a1, a2, a3] = a.split(".").map(Number);
  const [b1, b2, b3] = b.split(".").map(Number);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

// ── parse args ───────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--") && !a.startsWith("-"));
const flags = new Set(argv.filter((a) => a.startsWith("-")));
const skipPushPrompt = flags.has("--yes") || flags.has("-y");
const force = flags.has("--force");

if (positional.length !== 1) {
  fail("Usage: npm run release <version|patch|minor|major> [--yes] [--force]");
}

const target = positional[0];

// ── read current version (and verify alignment across the three files) ──

const pkgPath = join(ROOT, "package.json");
const tauriPath = join(ROOT, "src-tauri/tauri.conf.json");
const cargoPath = join(ROOT, "src-tauri/Cargo.toml");
const cargoLockPath = join(ROOT, "src-tauri/Cargo.lock");
const changesPath = join(ROOT, "CHANGES.md");

for (const p of [pkgPath, tauriPath, cargoPath, changesPath]) {
  if (!existsSync(p)) fail(`Missing required file: ${p}`);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
const tauri = JSON.parse(readFileSync(tauriPath, "utf8")) as { version: string };
const cargoSrc = readFileSync(cargoPath, "utf8");
const cargoMatch = cargoSrc.match(/^version = "(\d+\.\d+\.\d+)"$/m);

const currentVersion = pkg.version;
if (!isSemver(currentVersion)) fail(`package.json version is not semver: ${currentVersion}`);
if (tauri.version !== currentVersion) {
  fail(`Version drift: package.json=${currentVersion}, tauri.conf.json=${tauri.version}`);
}
if (!cargoMatch || cargoMatch[1] !== currentVersion) {
  fail(`Version drift: package.json=${currentVersion}, Cargo.toml=${cargoMatch?.[1] ?? "(not found)"}`);
}

// ── resolve target ──────────────────────────────────────────────────────

let nextVersion: string;
if (target === "patch" || target === "minor" || target === "major") {
  nextVersion = bump(currentVersion, target);
} else if (isSemver(target)) {
  nextVersion = target;
} else {
  fail(`Argument must be 'patch', 'minor', 'major', or X.Y.Z — got: ${target}`);
}

if (compareSemver(nextVersion, currentVersion) <= 0) {
  fail(`Target ${nextVersion} is not greater than current ${currentVersion}`);
}

console.log(`\n→ Releasing ${currentVersion} → ${nextVersion}\n`);

// ── pre-flight ──────────────────────────────────────────────────────────

const branch = capture("git rev-parse --abbrev-ref HEAD");
if (branch !== "main" && !force) {
  fail(`Not on main (currently '${branch}'). Use --force to override.`);
}

const status = capture("git status --porcelain");
if (status.length > 0) {
  fail("Working tree is not clean. Commit or stash first.");
}

const tag = `v${nextVersion}`;

try {
  execSync(`git rev-parse ${tag}`, { cwd: ROOT, stdio: "ignore" });
  fail(`Tag ${tag} already exists locally.`);
} catch {
  /* good — tag missing */
}

const remoteTag = capture(`git ls-remote --tags origin ${tag}`);
if (remoteTag.length > 0) fail(`Tag ${tag} already exists on origin.`);

// ── gate ────────────────────────────────────────────────────────────────

console.log("→ Running gate: tsc + vitest + build + cargo check\n");
run("npx tsc -p tsconfig.json --noEmit");
run("npx vitest run");
run("npm run build");
run("cargo check", { cwd: join(ROOT, "src-tauri") });

// ── mutate the three files ──────────────────────────────────────────────

console.log(`\n→ Bumping version to ${nextVersion}\n`);

pkg.version = nextVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

tauri.version = nextVersion;
writeFileSync(tauriPath, JSON.stringify(tauri, null, 2) + "\n");

const newCargoSrc = cargoSrc.replace(
  /^(version = ")\d+\.\d+\.\d+(")$/m,
  `$1${nextVersion}$2`
);
if (newCargoSrc === cargoSrc) fail("Cargo.toml regex did not match — aborting.");
writeFileSync(cargoPath, newCargoSrc);

// Refresh Cargo.lock for the new package version.
run("cargo check", { cwd: join(ROOT, "src-tauri") });

// ── changelog ───────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
const stubMarker = "<!-- WRITE YOUR CHANGELOG ENTRY ABOVE — leaving this comment will abort the release -->";
const stubBody = `## v${nextVersion} — TODO title (${today})

TODO: write the entry. Bullet what changed and why a user should care.

${stubMarker}

`;

const oldChanges = readFileSync(changesPath, "utf8");
const lines = oldChanges.split("\n");
// Insert after the H1 + the line immediately following it (usually a blank
// or a one-line description). Find the first H1, skip to first H2, insert
// just before that.
const firstH2 = lines.findIndex((l) => l.startsWith("## "));
const insertAt = firstH2 >= 0 ? firstH2 : lines.length;
lines.splice(insertAt, 0, stubBody);
writeFileSync(changesPath, lines.join("\n"));

const editor = process.env.EDITOR || process.env.VISUAL || "vim";
console.log(`\n→ Opening CHANGES.md in ${editor}. Write the entry, save, exit.\n`);
const editResult = spawnSync(editor, [changesPath], { stdio: "inherit", cwd: ROOT });
if (editResult.status !== 0) {
  console.warn(`Editor exited with status ${editResult.status} — continuing anyway.`);
}

const updatedChanges = readFileSync(changesPath, "utf8");
if (updatedChanges.includes(stubMarker)) {
  console.error("\n✗ Changelog stub was not edited (marker still present). Reverting all changes.\n");
  run("git checkout -- package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGES.md");
  process.exit(1);
}

// ── commit + tag ────────────────────────────────────────────────────────

console.log(`\n→ Committing release ${tag}\n`);
run(`git add ${pkgPath} ${tauriPath} ${cargoPath} ${cargoLockPath} ${changesPath}`);
run(`git commit -m "chore: release ${tag}"`);
run(`git tag ${tag}`);

// ── push prompt ─────────────────────────────────────────────────────────

if (!skipPushPrompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\nPush commit + ${tag} to origin? [y/N] `)).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    console.log(`\nNot pushed. When ready:\n  git push origin ${branch} && git push origin ${tag}\n`);
    process.exit(0);
  }
}

run(`git push origin ${branch}`);
run(`git push origin ${tag}`);

// ── done ────────────────────────────────────────────────────────────────

console.log(`\n✓ Released ${tag}\n`);
console.log(`Watch the workflow:   gh run watch`);
console.log(`Open the draft:       gh release view ${tag} --web`);
console.log(`Publish when ready:   gh release edit ${tag} --draft=false`);
console.log(`Homebrew users:       brew upgrade --cask keepr  (after publish)\n`);
