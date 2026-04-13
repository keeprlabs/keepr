mod secrets;
mod fs_atomic;

use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial_schema",
            kind: MigrationKind::Up,
            sql: r#"
CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('slack','github','anthropic','openai','openrouter')),
  metadata TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  github_handle TEXT,
  slack_user_id TEXT,
  slug TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_type TEXT NOT NULL CHECK (workflow_type IN ('team_pulse','one_on_one_prep')),
  target_member_id INTEGER REFERENCES team_members(id),
  time_range_start DATETIME NOT NULL,
  time_range_end DATETIME NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','complete','failed')),
  error_message TEXT,
  output_file_path TEXT,
  token_usage TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS evidence_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('github_pr','github_review','slack_message')),
  source_url TEXT NOT NULL,
  source_id TEXT NOT NULL,
  actor_member_id INTEGER REFERENCES team_members(id),
  timestamp_at DATETIME,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evidence_session ON evidence_items(session_id);
CREATE INDEX IF NOT EXISTS idx_evidence_actor ON evidence_items(actor_member_id);

CREATE TABLE IF NOT EXISTS fetch_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  last_fetched_at DATETIME NOT NULL,
  UNIQUE(source, scope)
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#,
        },
        Migration {
            version: 2,
            description: "secrets_table",
            kind: MigrationKind::Up,
            // Secrets live in SQLite, not the OS keychain. v1 rationale:
            // on unsigned macOS dev builds (and ad-hoc signed builds) the
            // keyring crate's writes "succeed" but can't be read back
            // because macOS Keychain ACLs are scoped to the writing
            // binary's code signature — which changes on every rebuild.
            // The SQLite DB already lives in the user's private app data
            // dir alongside everything else Keepr stores, so the trust
            // boundary is the same. Signed notarized builds can switch
            // back to keychain later.
            sql: r#"
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"#,
        },
        Migration {
            version: 3,
            description: "jira_linear_new_workflows",
            kind: MigrationKind::Up,
            // SQLite does not support ALTER TABLE … ALTER COLUMN to change
            // CHECK constraints. Instead we create new tables with the wider
            // constraints, copy existing data, drop the old tables, and rename.
            // This is the standard SQLite migration pattern for CHECK changes.
            sql: r#"
-- 1) integrations: add jira + linear to provider CHECK
CREATE TABLE integrations_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('slack','github','jira','linear','anthropic','openai','openrouter')),
  metadata TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO integrations_v3 SELECT * FROM integrations;
DROP TABLE integrations;
ALTER TABLE integrations_v3 RENAME TO integrations;

-- 2) sessions: add weekly_update, perf_evaluation, promo_readiness to workflow_type CHECK
CREATE TABLE sessions_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_type TEXT NOT NULL CHECK (workflow_type IN ('team_pulse','one_on_one_prep','weekly_update','perf_evaluation','promo_readiness')),
  target_member_id INTEGER REFERENCES team_members(id),
  time_range_start DATETIME NOT NULL,
  time_range_end DATETIME NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','complete','failed')),
  error_message TEXT,
  output_file_path TEXT,
  token_usage TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);
INSERT INTO sessions_v3 SELECT * FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_v3 RENAME TO sessions;

-- 3) evidence_items: add jira_issue, jira_comment, linear_issue, linear_comment
CREATE TABLE evidence_items_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('github_pr','github_review','slack_message','jira_issue','jira_comment','linear_issue','linear_comment')),
  source_url TEXT NOT NULL,
  source_id TEXT NOT NULL,
  actor_member_id INTEGER REFERENCES team_members(id),
  timestamp_at DATETIME,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO evidence_items_v3 SELECT * FROM evidence_items;
DROP TABLE evidence_items;
ALTER TABLE evidence_items_v3 RENAME TO evidence_items;

CREATE INDEX IF NOT EXISTS idx_evidence_session ON evidence_items(session_id);
CREATE INDEX IF NOT EXISTS idx_evidence_actor ON evidence_items(actor_member_id);

-- 4) Add jira_username and linear_username to team_members for actor resolution
ALTER TABLE team_members ADD COLUMN jira_username TEXT;
ALTER TABLE team_members ADD COLUMN linear_username TEXT;
"#,
        },
        Migration {
            version: 4,
            description: "session_archive",
            kind: MigrationKind::Up,
            sql: r#"
ALTER TABLE sessions ADD COLUMN archived_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived_at);
"#,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:keepr.db", migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            fs_atomic::write_file_atomic,
            fs_atomic::read_file_if_exists,
            fs_atomic::file_mtime_and_hash,
            fs_atomic::ensure_dir,
            fs_atomic::acquire_lock,
            fs_atomic::release_lock,
            fs_atomic::list_md_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Keepr");
}
