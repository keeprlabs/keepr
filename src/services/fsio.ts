// Filesystem helpers that go through the Rust atomic-write bridge so the
// memory files on disk are never half-written or clobbered.

import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";

export interface FileMeta {
  exists: boolean;
  mtime_ms: number;
  sha256: string;
}

export async function ensureDir(path: string): Promise<void> {
  await invoke("ensure_dir", { path });
}

export async function writeFileAtomic(
  path: string,
  contents: string
): Promise<void> {
  await invoke("write_file_atomic", { path, contents });
}

export async function readFileIfExists(path: string): Promise<string | null> {
  return (await invoke<string | null>("read_file_if_exists", { path })) ?? null;
}

export async function fileMeta(path: string): Promise<FileMeta> {
  return invoke<FileMeta>("file_mtime_and_hash", { path });
}

export async function acquireLock(path: string): Promise<boolean> {
  return invoke<boolean>("acquire_lock", { path });
}

export async function releaseLock(path: string): Promise<void> {
  await invoke("release_lock", { path });
}

export async function defaultMemoryDir(): Promise<string> {
  const home = await homeDir();
  return join(home, "Documents", "Keepr");
}

export async function listMdFiles(dir: string): Promise<string[]> {
  return invoke<string[]>("list_md_files", { dir });
}
