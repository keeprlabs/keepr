mod fs_atomic;
mod memory;
mod secrets;

use tauri::{Manager, WindowEvent};
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
        Migration {
            version: 5,
            description: "add_custom_and_claude_code_providers",
            kind: MigrationKind::Up,
            sql: r#"
CREATE TABLE integrations_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('slack','github','jira','linear','anthropic','openai','openrouter','custom','claude-code')),
  metadata TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO integrations_v5 SELECT * FROM integrations;
DROP TABLE integrations;
ALTER TABLE integrations_v5 RENAME TO integrations;
"#,
        },
        Migration {
            version: 6,
            description: "person_facts_and_query_history",
            kind: MigrationKind::Up,
            sql: r#"
CREATE TABLE person_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  fact_type TEXT NOT NULL CHECK (fact_type IN ('shipped','reviewed','discussed','blocked','collaborated','led')),
  summary TEXT NOT NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_person_facts_member ON person_facts(member_id);
CREATE INDEX idx_person_facts_session ON person_facts(session_id);

CREATE TABLE query_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  query TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_query_history_member ON query_history(member_id);
"#,
        },
        Migration {
            version: 7,
            description: "followups_table",
            kind: MigrationKind::Up,
            sql: r#"
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','carried','resolved')),
  origin_session INTEGER,
  origin_member_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_followups_state ON followups(state);
CREATE INDEX IF NOT EXISTS idx_followups_member ON followups(origin_member_id);
"#,
        },
        Migration {
            version: 8,
            description: "gitlab_support",
            kind: MigrationKind::Up,
            // Widen integration + evidence CHECK constraints to include GitLab,
            // and add gitlab_username to team_members for actor resolution.
            // Table-rebuild pattern matches migrations 3 and 5 — SQLite can't
            // ALTER a CHECK in place.
            sql: r#"
-- 1) integrations: add gitlab to provider CHECK
CREATE TABLE integrations_v8 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('slack','github','gitlab','jira','linear','anthropic','openai','openrouter','custom','claude-code')),
  metadata TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO integrations_v8 SELECT * FROM integrations;
DROP TABLE integrations;
ALTER TABLE integrations_v8 RENAME TO integrations;

-- 2) evidence_items: add gitlab_mr, gitlab_review to source CHECK
CREATE TABLE evidence_items_v8 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('github_pr','github_review','gitlab_mr','gitlab_review','slack_message','jira_issue','jira_comment','linear_issue','linear_comment')),
  source_url TEXT NOT NULL,
  source_id TEXT NOT NULL,
  actor_member_id INTEGER REFERENCES team_members(id),
  timestamp_at DATETIME,
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO evidence_items_v8 SELECT * FROM evidence_items;
DROP TABLE evidence_items;
ALTER TABLE evidence_items_v8 RENAME TO evidence_items;

CREATE INDEX IF NOT EXISTS idx_evidence_session ON evidence_items(session_id);
CREATE INDEX IF NOT EXISTS idx_evidence_actor ON evidence_items(actor_member_id);

-- 3) team_members: add gitlab_username column
ALTER TABLE team_members ADD COLUMN gitlab_username TEXT;
"#,
        },
        Migration {
            version: 9,
            description: "evidence_subject_path",
            kind: MigrationKind::Up,
            // v0.2.6: every evidence row gets a ctxd subject path so the UI
            // can pivot from a citation back to the canonical event. Column
            // is nullable; populated forward-only by the dual-write in PR 3.
            // Older rows stay NULL until the v0.4 markdown bulk-import lands.
            sql: r#"
ALTER TABLE evidence_items ADD COLUMN subject_path TEXT;
CREATE INDEX IF NOT EXISTS idx_evidence_subject_path ON evidence_items(subject_path);
"#,
        },
        Migration {
            version: 10,
            description: "team_member_ctxd_uuid",
            kind: MigrationKind::Up,
            // v0.2.6: stable UUID per person used as the ctxd subject ID
            // (`/keepr/people/{uuid}`). Slugs stay for human-readable URLs
            // but are not used as ctxd subjects — see ADR-001 once written.
            // Populated lazily on first event write per person.
            sql: r#"
ALTER TABLE team_members ADD COLUMN ctxd_uuid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_ctxd_uuid
  ON team_members(ctxd_uuid) WHERE ctxd_uuid IS NOT NULL;
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("keepr".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .max_file_size(10 * 1024 * 1024)
                .build(),
        )
        .setup(|app| {
            // Memory subsystem: own a DaemonHandle in managed state and
            // spawn the ctxd sidecar in the background so the splash
            // screen does not block on the health probe. Failures
            // transition the handle to Offline and surface via
            // `memory_status`; the rest of the app continues to work
            // (markdown-tail path remains the v0.2.6 prompt builder).
            app.manage(memory::DaemonHandle::new());
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = app_handle.state::<memory::DaemonHandle>();
                if let Err(err) = memory::spawn(&app_handle, state.inner()).await {
                    log::error!(target: "memory", "ctxd sidecar failed to start: {err}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // Best-effort SIGTERM. The shutdown is fast (Mutex grab +
                // child.kill); blocking the close event briefly is fine.
                let app_handle = window.app_handle().clone();
                tauri::async_runtime::block_on(async move {
                    let state = app_handle.state::<memory::DaemonHandle>();
                    memory::shutdown(state.inner()).await;
                });
            }
        })
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
            memory::memory_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Keepr");
}
