// CLI subcommands for Keepr. Runs without the Tauri runtime — reads the same
// SQLite DB via the system `sqlite3` binary (ships with macOS) and writes
// follow-up files directly to disk.
//
// Subcommands:
//   keepr cli status         — config summary
//   keepr cli open           — launch the GUI
//   keepr cli add-followup   — create a follow-up file
//   keepr cli pulse          — open the app to run team pulse
//   keepr cli version        — print version
//   keepr cli check-update   — check GitHub for newer version

use chrono::Utc;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const GITHUB_REPO: &str = "keeprhq/keepr";

// ---- DB helpers (via system sqlite3) --------------------------------------

fn db_path() -> Option<PathBuf> {
    let base = dirs::data_dir()?; // ~/Library/Application Support
    let path = base.join("app.keepr.desktop").join("keepr.db");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

/// Run a SQL query via the system `sqlite3` CLI and return stdout.
fn sql_query(query: &str) -> Result<String, String> {
    let db = db_path().ok_or_else(|| {
        "Keepr database not found. Launch the Keepr desktop app first to initialize.".to_string()
    })?;
    let output = Command::new("sqlite3")
        .args(["-separator", "\t", db.to_str().unwrap(), query])
        .output()
        .map_err(|e| format!("Failed to run sqlite3: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        // Table-not-found is fine for optional tables like followups.
        if err.contains("no such table") {
            return Ok(String::new());
        }
        return Err(format!("sqlite3 error: {err}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Get a single config value, stripping JSON string quotes.
fn get_config_value(key: &str) -> Option<String> {
    let raw = sql_query(&format!(
        "SELECT value FROM app_config WHERE key = '{key}';"
    ))
    .ok()?;
    if raw.is_empty() {
        return None;
    }
    // Config values are stored as JSON — strip surrounding quotes.
    let trimmed = raw.trim_matches('"');
    Some(trimmed.to_string())
}

fn get_memory_dir() -> Option<String> {
    get_config_value("memory_dir")
}

// ---- Subcommands ----------------------------------------------------------

fn cmd_version() {
    println!("keepr {VERSION}");
}

fn cmd_status() -> Result<(), String> {
    let provider = get_config_value("llm_provider").unwrap_or_else(|| "not configured".into());
    let model = get_config_value("synthesis_model").unwrap_or_else(|| "default".into());

    let sources_raw = sql_query(
        "SELECT provider FROM integrations WHERE status = 'active' ORDER BY provider;",
    )?;
    let sources: Vec<&str> = sources_raw.lines().filter(|l| !l.is_empty()).collect();

    let memory_dir = get_memory_dir().unwrap_or_else(|| "not configured".into());

    let last_session = sql_query(
        "SELECT created_at FROM sessions ORDER BY created_at DESC LIMIT 1;",
    )?;

    let member_count = sql_query("SELECT COUNT(*) FROM team_members;")?;

    let followup_count =
        sql_query("SELECT COUNT(*) FROM followups WHERE state = 'open';").unwrap_or_default();

    println!("Keepr v{VERSION}");
    println!();
    println!("LLM:             {provider} ({model})");
    println!(
        "Sources:         {}",
        if sources.is_empty() {
            "none connected".into()
        } else {
            sources.join(", ")
        }
    );
    println!("Memory dir:      {memory_dir}");
    println!(
        "Team members:    {}",
        if member_count.is_empty() { "0" } else { &member_count }
    );
    println!(
        "Last session:    {}",
        if last_session.is_empty() {
            "none"
        } else {
            &last_session
        }
    );
    println!(
        "Open follow-ups: {}",
        if followup_count.is_empty() {
            "0"
        } else {
            &followup_count
        }
    );

    Ok(())
}

fn cmd_open(session: Option<i64>, prep: Option<String>) -> Result<(), String> {
    let mut cmd = Command::new("open");
    cmd.arg("-a").arg("Keepr");

    if let Some(sid) = session {
        eprintln!("Hint: navigate to session #{sid} in the app.");
    }
    if let Some(name) = prep {
        eprintln!("Hint: run ⌘K → \"1:1 prep — {name}\" in the app.");
    }

    cmd.spawn().map_err(|e| {
        format!(
            "Failed to launch Keepr: {e}\n\
             Make sure Keepr.app is in /Applications.\n\
             Install via: brew install --cask keeprhq/tap/keepr"
        )
    })?;

    println!("Keepr is opening.");
    Ok(())
}

fn cmd_add_followup(text: &str, subject: Option<&str>) -> Result<(), String> {
    let memory_dir = get_memory_dir()
        .ok_or("Memory directory not configured. Open Keepr desktop app and complete setup.")?;

    let followups_dir = PathBuf::from(&memory_dir).join("followups");
    fs::create_dir_all(&followups_dir)
        .map_err(|e| format!("Failed to create followups dir: {e}"))?;

    // Derive subject from text if not provided.
    let subj = subject.map(|s| s.to_string()).unwrap_or_else(|| {
        let end = text
            .find(|c: char| c == '.' || c == '!' || c == '?')
            .map(|i| i + 1)
            .unwrap_or_else(|| text.len().min(60));
        text[..end].to_string()
    });

    let now = Utc::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let slug = slugify(&subj);
    let filename = format!("{date_str}-{slug}.md");
    let filepath = followups_dir.join(&filename);

    let content = format!(
        "---\n\
         subject: {subj}\n\
         state: open\n\
         origin_session: null\n\
         origin_member_id: null\n\
         created_at: {now}\n\
         resolved_at: null\n\
         ---\n\
         \n\
         {text}\n",
        subj = subj,
        now = now.to_rfc3339(),
        text = text,
    );

    // Atomic write: temp file then rename.
    let tmp = filepath.with_extension("md.tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Write failed: {e}"))?;
        f.write_all(content.as_bytes())
            .map_err(|e| format!("Write failed: {e}"))?;
        f.sync_all().map_err(|e| format!("Sync failed: {e}"))?;
    }
    fs::rename(&tmp, &filepath).map_err(|e| format!("Rename failed: {e}"))?;

    // Skip the SQLite insert entirely. The file on disk is the source of truth,
    // and the GUI's syncFollowUpsIndex() rebuilds the index on next launch.
    // This avoids SQL injection risk from user-provided text in CLI args.

    println!("{}", filepath.display());
    Ok(())
}

fn cmd_pulse() -> Result<(), String> {
    println!("Opening Keepr to run team pulse...");
    println!();
    println!("The data pipeline requires the full desktop app (Slack/GitHub API");
    println!("calls, LLM synthesis, memory writes). Once Keepr opens:");
    println!();
    println!("  Press ⌘K → \"Run team pulse\"");
    println!();

    cmd_open(None, None)?;
    Ok(())
}

fn cmd_check_update() -> Result<(), String> {
    let latest = fetch_latest_version()?;
    let current = semver_tuple(VERSION);
    let remote = semver_tuple(&latest);

    if remote > current {
        println!("Update available: v{VERSION} → v{latest}");
        println!();
        println!("  brew upgrade --cask keepr");
        println!();
        println!(
            "Or download from: https://github.com/{GITHUB_REPO}/releases/latest"
        );
        std::process::exit(1); // Non-zero so plugin scripts can detect it.
    } else {
        println!("keepr v{VERSION} is up to date.");
    }
    Ok(())
}

// ---- Helpers --------------------------------------------------------------

fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(64)
        .collect()
}

fn fetch_latest_version() -> Result<String, String> {
    let output = Command::new("curl")
        .args([
            "-sL",
            "-H",
            "Accept: application/vnd.github.v3+json",
            &format!(
                "https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
            ),
        ])
        .output()
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    let body = String::from_utf8_lossy(&output.stdout);

    // Parse tag_name from JSON without a JSON crate.
    let tag = body
        .split("\"tag_name\"")
        .nth(1)
        .and_then(|s| s.split('"').nth(2))
        .ok_or_else(|| "Could not parse latest version from GitHub.".to_string())?;

    Ok(tag.trim_start_matches('v').to_string())
}

fn semver_tuple(v: &str) -> (u32, u32, u32) {
    let parts: Vec<u32> = v
        .trim_start_matches('v')
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    (
        parts.first().copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    )
}

// ---- Entry point ----------------------------------------------------------

pub fn run(args: &[String]) -> Result<(), String> {
    if args.len() < 2 {
        print_help();
        return Ok(());
    }

    match args[1].as_str() {
        "version" | "--version" | "-v" => {
            cmd_version();
            Ok(())
        }
        "status" => cmd_status(),
        "open" => {
            let session =
                find_flag_value(args, "--session").and_then(|s| s.parse::<i64>().ok());
            let prep = find_flag_value(args, "--prep");
            cmd_open(session, prep)
        }
        "add-followup" => {
            let text = args.get(2).ok_or(
                "Usage: keepr cli add-followup \"<text>\" [--subject <name>]"
                    .to_string(),
            )?;
            let subject = find_flag_value(args, "--subject");
            cmd_add_followup(text, subject.as_deref())
        }
        "pulse" => cmd_pulse(),
        "check-update" => cmd_check_update(),
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        other => {
            eprintln!("Unknown subcommand: {other}");
            eprintln!();
            print_help();
            std::process::exit(1);
        }
    }
}

fn find_flag_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn print_help() {
    println!("keepr cli — command-line interface for Keepr");
    println!();
    println!("USAGE:");
    println!("  keepr cli <command> [options]");
    println!();
    println!("COMMANDS:");
    println!("  status            Show config, connected sources, last session");
    println!("  open              Launch the Keepr desktop app");
    println!("    --session N     Open a specific session");
    println!("    --prep <name>   Hint to open 1:1 prep for a team member");
    println!("  add-followup \"<text>\"  Create a follow-up item");
    println!("    --subject <s>   Override the auto-derived subject line");
    println!("  pulse             Open Keepr to run a team pulse");
    println!("  version           Print version");
    println!("  check-update      Check for newer versions on GitHub");
    println!("  help              Show this help");
}
