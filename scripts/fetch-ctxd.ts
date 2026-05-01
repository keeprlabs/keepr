#!/usr/bin/env tsx
// Fetch the bundled `ctxd` binary into `src-tauri/binaries/` so Tauri's
// `externalBin` packages it into the app. Runs at dev/build time on the
// developer's machine and in CI — never on end-user machines, since the
// DMG ships ctxd inside Keepr.app.
//
// Targets:
//   - Dev/test: host triple only (e.g. aarch64-apple-darwin on Apple Silicon).
//   - Release: set CTXD_TARGET=universal-apple-darwin to fetch both macOS
//     architectures and `lipo` them into a single universal binary.
//
// Idempotent: skips download if the binary already exists with a matching
// SHA256 against the upstream checksums file.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CTXD_VERSION = "0.3.0";
const REPO = "keeprlabs/ctxd";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const BIN_DIR = join(REPO_ROOT, "src-tauri", "binaries");

type ReleaseTriple =
  | "aarch64-apple-darwin"
  | "x86_64-apple-darwin"
  | "aarch64-unknown-linux-gnu"
  | "x86_64-unknown-linux-gnu";

function hostTriple(): ReleaseTriple {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "darwin" && arch === "x64") return "x86_64-apple-darwin";
  if (platform === "linux" && arch === "arm64") return "aarch64-unknown-linux-gnu";
  if (platform === "linux" && arch === "x64") return "x86_64-unknown-linux-gnu";
  throw new Error(`unsupported host: ${platform}/${arch}`);
}

function tarballName(triple: ReleaseTriple): string {
  return `ctxd-${CTXD_VERSION}-${triple}.tar.gz`;
}

function downloadUrl(asset: string): string {
  return `https://github.com/${REPO}/releases/download/v${CTXD_VERSION}/${asset}`;
}

async function fetchToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

async function downloadAndVerify(triple: ReleaseTriple, workDir: string): Promise<string> {
  const tarball = tarballName(triple);
  const tarballPath = join(workDir, tarball);
  const shaPath = `${tarballPath}.sha256`;

  console.log(`[fetch-ctxd] downloading ${tarball}`);
  await fetchToFile(downloadUrl(tarball), tarballPath);
  await fetchToFile(downloadUrl(`${tarball}.sha256`), shaPath);

  // Upstream sha256 file format: "<hex>  <filename>"
  const expected = readFileSync(shaPath, "utf8").trim().split(/\s+/)[0];
  const actual = sha256(tarballPath);
  if (expected !== actual) {
    throw new Error(`sha256 mismatch for ${tarball}\n  expected: ${expected}\n  actual:   ${actual}`);
  }

  // Extract — tarball contains `ctxd-<version>-<triple>/ctxd`.
  run("tar", ["-xzf", tarballPath, "-C", workDir]);
  const extractedBin = join(workDir, `ctxd-${CTXD_VERSION}-${triple}`, "ctxd");
  if (!existsSync(extractedBin)) {
    throw new Error(`expected binary at ${extractedBin} after extract`);
  }
  return extractedBin;
}

function isAlreadyFetched(targetPath: string, expectedTriple: ReleaseTriple): boolean {
  if (!existsSync(targetPath)) return false;
  const stampPath = `${targetPath}.stamp`;
  if (!existsSync(stampPath)) return false;
  const stamp = readFileSync(stampPath, "utf8").trim();
  return stamp === `${CTXD_VERSION}:${expectedTriple}`;
}

function writeStamp(targetPath: string, triple: ReleaseTriple): void {
  writeFileSync(`${targetPath}.stamp`, `${CTXD_VERSION}:${triple}\n`);
}

async function fetchSingleTarget(triple: ReleaseTriple): Promise<void> {
  const targetPath = join(BIN_DIR, `ctxd-${triple}`);
  if (isAlreadyFetched(targetPath, triple)) {
    console.log(`[fetch-ctxd] up-to-date: ctxd-${triple} (v${CTXD_VERSION})`);
    return;
  }

  const workDir = join(tmpdir(), `keepr-fetch-ctxd-${process.pid}`);
  mkdirSync(workDir, { recursive: true });
  mkdirSync(BIN_DIR, { recursive: true });

  const extractedBin = await downloadAndVerify(triple, workDir);
  // Move (copy + chmod) into binaries dir.
  writeFileSync(targetPath, readFileSync(extractedBin));
  chmodSync(targetPath, 0o755);
  writeStamp(targetPath, triple);
  console.log(`[fetch-ctxd] installed ctxd-${triple} -> ${targetPath}`);
}

async function fetchUniversalAppleDarwin(): Promise<void> {
  // Tauri's universal-apple-darwin target compiles each architecture
  // separately and lipos the resulting .app bundles itself. Each
  // per-arch compile looks up `binaries/ctxd-{triple}` via the
  // externalBin manifest — so we install both per-arch binaries and
  // let Tauri's bundler do the lipo. Producing our own pre-merged
  // `ctxd-universal-apple-darwin` would leave the per-arch lookups
  // failing with "resource path doesn't exist".
  if (process.platform !== "darwin") {
    throw new Error("CTXD_TARGET=universal-apple-darwin requires running on macOS");
  }
  await fetchSingleTarget("aarch64-apple-darwin");
  await fetchSingleTarget("x86_64-apple-darwin");
}

async function main(): Promise<void> {
  const target = (process.env.CTXD_TARGET || "").trim();

  if (target === "universal-apple-darwin") {
    await fetchUniversalAppleDarwin();
  } else if (target) {
    await fetchSingleTarget(target as ReleaseTriple);
  } else {
    await fetchSingleTarget(hostTriple());
  }
}

main().catch((err) => {
  console.error(`[fetch-ctxd] FAILED: ${err.message}`);
  process.exit(1);
});
