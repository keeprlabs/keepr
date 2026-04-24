// Secret storage. v1 persists to the local SQLite DB (the `secrets` table,
// migration v2), NOT the OS keychain.
//
// Rationale: on unsigned macOS dev builds and ad-hoc signed builds, the
// keyring crate's writes appear to succeed but can't be read back later
// because macOS Keychain ACLs are scoped to the writing binary's code
// signature, which changes on every `tauri dev` rebuild. The SQLite DB
// already lives in the user's private app data dir alongside memory files,
// session outputs, and config — same trust boundary. Signed notarized
// production builds can switch back to the keychain later without changing
// this API surface.

import Database from "@tauri-apps/plugin-sql";

export const SECRET_KEYS = {
  anthropic: "llm.anthropic.key",
  openai: "llm.openai.key",
  openrouter: "llm.openrouter.key",
  custom: "llm.custom.key",
  "claude-code": "llm.claude-code.key",
  github: "github.token",
  gitlab: "gitlab.token",
  slackBot: "slack.bot_token",
  slackClientId: "slack.client_id",
  slackClientSecret: "slack.client_secret",
  jiraEmail: "jira.email",
  jiraToken: "jira.api_token",
  linear: "linear.api_key",
} as const;

let _db: Database | null = null;
async function db(): Promise<Database> {
  if (!_db) {
    _db = await Database.load("sqlite:keepr.db");
  }
  return _db;
}

export async function setSecret(key: string, value: string): Promise<void> {
  const d = await db();
  await d.execute(
    "INSERT INTO secrets(key, value, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
    [key, value]
  );
}

export async function getSecret(key: string): Promise<string | null> {
  const d = await db();
  const rows = await d.select<Array<{ value: string }>>(
    "SELECT value FROM secrets WHERE key = ?",
    [key]
  );
  return rows[0]?.value ?? null;
}

export async function deleteSecret(key: string): Promise<void> {
  const d = await db();
  await d.execute("DELETE FROM secrets WHERE key = ?", [key]);
}
