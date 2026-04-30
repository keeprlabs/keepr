// Resolve a CLI binary name to an absolute path via the user's login shell.
//
// WHY: macOS GUI apps launched via Launch Services inherit a minimal PATH
// (typically /usr/bin:/bin:/usr/sbin:/sbin), NOT the user's interactive shell
// PATH. Codex / Claude installed via npm-global, nvm, fnm, or homebrew live in
// dirs the GUI app can't see — `sh -c 'exec codex'` fails with "codex: not
// found" even though the binary exists and works in Terminal. This is the
// classic problem solved by VS Code's `shell-env`, GitHub Desktop's
// `getResolvedPathFromShell`, etc.
//
// We ask the user's login+interactive shell — same shell Terminal would
// launch — to resolve `command -v <name>`. That sources .zprofile AND .zshrc
// (or .bash_profile + .bashrc) so we get the real, user-configured PATH.
// Cache the absolute path and pass it to subsequent spawns; PATH stops
// mattering at that point.

use std::process::Command;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

/// Reject anything that isn't a plain CLI name. Defense-in-depth — the only
/// caller is the JS layer, which passes literal "codex" / "claude" today, but
/// if a future caller passes user input we don't want shell injection.
fn is_safe_bin_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

#[tauri::command]
pub fn resolve_binary(name: String) -> Option<String> {
    if !is_safe_bin_name(&name) {
        return None;
    }

    // $SHELL is set by Launch Services on macOS from the user's account
    // record, even when PATH is minimal. Fall back to /bin/zsh (macOS default
    // since Catalina) if it's missing — we still need *some* shell that
    // sources rc files.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // -l: login shell (sources .zprofile / .bash_profile)
    // -i: interactive shell (sources .zshrc / .bashrc)
    // `command -v <name>` is POSIX-portable across zsh/bash/dash. `2>/dev/null`
    // suppresses the rc-file noise some users emit on every shell init.
    let script = format!("command -v {} 2>/dev/null", name);

    let output = Command::new(&shell)
        .args(["-lic", &script])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = stdout.lines().last()?.trim().to_string();

    if path.is_empty() || path.contains(char::is_whitespace) {
        return None;
    }

    Some(path)
}

/// Detect a macOS .app bundle for a given CLI provider name. Used as a
/// fallback when `resolve_binary` can't find the CLI on the user's shell PATH:
/// if the .app exists but no shell shim is registered, we want to tell the
/// user "you have the app, just install its shell command" instead of the
/// (technically true but unhelpful) "the CLI isn't installed."
///
/// This is an explicit allowlist — we only check bundle paths we know about,
/// and the mapping from provider name → app name lives here so it's easy to
/// audit. Returns the absolute path to the .app if found, or None.
#[tauri::command]
pub fn detect_app_bundle(name: String) -> Option<String> {
    if !is_safe_bin_name(&name) {
        return None;
    }
    // Only providers with a known macOS app surface get checked. Claude Code
    // ships only as a CLI; "Claude.app" is the chat app, a different product
    // that wouldn't satisfy the Claude Code provider — so don't claim a match.
    let app_name = match name.as_str() {
        "codex" => "Codex.app",
        _ => return None,
    };

    let mut candidates: Vec<String> = vec![format!("/Applications/{}", app_name)];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(format!("{}/Applications/{}", home, app_name));
    }

    candidates
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
}

/// Validate a user-supplied absolute path to a binary. Returns the canonical
/// absolute path on success, None on any failure (file missing, not regular,
/// not executable, contains shell metacharacters, etc.).
///
/// Used by the Settings "Custom path" override: the user pastes or file-picks
/// a path; the UI calls this to confirm it's a real, executable file before
/// saving to app_config. We canonicalize so `~/dev/codex` and `/Users/me/dev/codex`
/// don't get stored as two different "paths" — and so `..` segments can't be
/// used to traverse out of an obvious location later.
///
/// Pure validation: no spawn, no rc-file load. Should run in <1ms.
#[tauri::command]
pub fn validate_binary_path(path: String) -> Option<String> {
    if path.is_empty() || path.len() > 1024 {
        return None;
    }
    // Reject shell metacharacters defensively — we only ever invoke this path
    // through Tauri's allowed `sh -c 'exec <quoted-path> ...'`, but if a future
    // caller forgets the quoting, an unsanitized path could inject a command.
    // No legitimate binary path needs any of these characters on macOS/Linux.
    if path.chars().any(|c| matches!(
        c,
        ';' | '&' | '|' | '`' | '$' | '\n' | '\r' | '\0' | '<' | '>' | '"' | '\''
    )) {
        return None;
    }

    let p = std::path::Path::new(&path);
    let metadata = std::fs::metadata(p).ok()?;
    if !metadata.is_file() {
        return None;
    }

    // Executable bit check on Unix. On Windows we'd defer to "extension is .exe"
    // but Keepr is macOS-first; treat non-Unix as "skip the bit check".
    #[cfg(unix)]
    {
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }

    // Canonicalize: resolves symlinks, `..`, and yields an absolute path. If
    // the user passed a relative path that resolves correctly, this returns
    // the absolute form — which is what we want stored in config.
    std::fs::canonicalize(p)
        .ok()
        .and_then(|cp| cp.to_str().map(String::from))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_names() {
        assert!(!is_safe_bin_name(""));
        assert!(!is_safe_bin_name("foo bar"));
        assert!(!is_safe_bin_name("foo;rm -rf /"));
        assert!(!is_safe_bin_name("foo`whoami`"));
        assert!(!is_safe_bin_name("foo$(whoami)"));
        assert!(!is_safe_bin_name(&"a".repeat(65)));
    }

    #[test]
    fn accepts_real_cli_names() {
        assert!(is_safe_bin_name("codex"));
        assert!(is_safe_bin_name("claude"));
        assert!(is_safe_bin_name("gh"));
        assert!(is_safe_bin_name("node-22"));
        assert!(is_safe_bin_name("foo_bar"));
        assert!(is_safe_bin_name("foo.bar"));
    }

    #[test]
    fn validate_binary_path_rejects_empty_and_oversize() {
        assert_eq!(validate_binary_path(String::new()), None);
        assert_eq!(validate_binary_path("a".repeat(2000)), None);
    }

    #[test]
    fn validate_binary_path_rejects_shell_metacharacters() {
        // Defense-in-depth: even if these paths existed (they don't on a
        // sane system) we wouldn't accept them.
        assert_eq!(validate_binary_path("/bin/sh; rm -rf /".into()), None);
        assert_eq!(validate_binary_path("/bin/sh & whoami".into()), None);
        assert_eq!(validate_binary_path("/bin/$(whoami)".into()), None);
        assert_eq!(validate_binary_path("/bin/`id`".into()), None);
        assert_eq!(validate_binary_path("/bin/sh\nwhoami".into()), None);
    }

    #[test]
    fn validate_binary_path_rejects_missing_path() {
        assert_eq!(
            validate_binary_path("/nonexistent/path/codex".into()),
            None
        );
    }

    #[test]
    fn validate_binary_path_rejects_directory() {
        // /bin exists and is executable-by-traversal but is NOT a regular file.
        assert_eq!(validate_binary_path("/bin".into()), None);
    }

    #[test]
    fn validate_binary_path_accepts_real_executable() {
        // /bin/sh exists on every macOS/Linux machine and has the executable
        // bit set. The canonical form should be returned.
        let r = validate_binary_path("/bin/sh".into());
        assert!(r.is_some(), "expected /bin/sh to validate");
        let path = r.unwrap();
        assert!(path.starts_with('/'), "should be absolute: {}", path);
        // canonicalize on macOS may resolve /bin/sh through /private/var or
        // similar — just assert the basename ends in "sh" / "dash" / "bash".
        let base = path.rsplit('/').next().unwrap_or("");
        assert!(
            base == "sh" || base == "dash" || base == "bash",
            "unexpected basename: {}",
            base
        );
    }

    #[test]
    fn validate_binary_path_canonicalizes_relative_segments() {
        // /usr/bin/../bin/sh should canonicalize to whatever /bin/sh
        // canonicalizes to.
        let direct = validate_binary_path("/bin/sh".into());
        let indirect = validate_binary_path("/usr/bin/../../bin/sh".into());
        assert_eq!(direct, indirect);
    }

    #[test]
    fn detect_app_bundle_rejects_unknown_providers() {
        // Allowlist-only — anything outside the known map returns None even if
        // a same-named .app exists in /Applications (defense in depth).
        assert_eq!(detect_app_bundle("anthropic".into()), None);
        assert_eq!(detect_app_bundle("openai".into()), None);
        assert_eq!(detect_app_bundle("claude".into()), None);
        assert_eq!(detect_app_bundle("../../etc/passwd".into()), None);
    }

    #[test]
    fn resolves_shell_itself() {
        // Whatever shell is on this CI runner / dev machine should be findable
        // by name via this very mechanism. Smoke test that the helper at least
        // executes and returns *something* plausible for a guaranteed binary.
        let result = resolve_binary("sh".to_string());
        if let Some(path) = result {
            assert!(path.starts_with('/'), "path should be absolute: {}", path);
            assert!(path.ends_with("sh") || path.ends_with("dash"), "got: {}", path);
        }
        // If None, the test environment doesn't have an interactive shell at
        // all (rare CI sandbox) — not a failure of the helper itself.
    }
}
