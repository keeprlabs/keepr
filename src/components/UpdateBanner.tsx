// Update banner — checks GitHub Releases for a newer version on mount.
// Shows a dismissable bar at the top of the main view if an update exists.
// Checks at most once per 24 hours (cached in localStorage).

import { useEffect, useState } from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

// Injected by Vite from package.json at build time (see vite.config.ts define).
// Fallback to manual value if the define isn't configured yet.
const CURRENT_VERSION: string =
  typeof __KEEPR_VERSION__ !== "undefined" ? __KEEPR_VERSION__ : "0.2.1";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const STORAGE_KEY = "keepr_update_check";
const GITHUB_API = "https://api.github.com/repos/keeprhq/keepr/releases/latest";

interface CachedCheck {
  checkedAt: number;
  latestVersion: string | null;
}

export function UpdateBanner() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkForUpdate().then((v) => {
      if (v && isNewer(v, CURRENT_VERSION)) {
        setLatestVersion(v);
      }
    });
  }, []);

  if (!latestVersion || dismissed) return null;

  return (
    <div className="flex items-center justify-between bg-[rgba(47,58,76,0.06)] px-6 py-2 text-xs text-ink-muted">
      <span>
        Keepr <strong>v{latestVersion}</strong> is available.{" "}
        <span className="text-ink-faint">
          Run{" "}
          <code className="rounded bg-[rgba(10,10,10,0.06)] px-1 py-0.5 text-[10px]">
            brew upgrade --cask keepr
          </code>{" "}
          to update.
        </span>
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-4 text-ink-faint transition-colors duration-180 hover:text-ink"
        aria-label="Dismiss update notification"
      >
        ×
      </button>
    </div>
  );
}

async function checkForUpdate(): Promise<string | null> {
  // Check cache first.
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const data: CachedCheck = JSON.parse(cached);
      if (Date.now() - data.checkedAt < CHECK_INTERVAL_MS) {
        return data.latestVersion;
      }
    }
  } catch {
    // Ignore cache errors.
  }

  // Fetch from GitHub.
  try {
    const response = await tauriFetch(GITHUB_API, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Keepr-Desktop",
      },
    });

    if (!response.ok) return null;

    const data = await response.json() as { tag_name?: string };
    const version = data.tag_name?.replace(/^v/, "") || null;

    // Cache the result.
    const check: CachedCheck = {
      checkedAt: Date.now(),
      latestVersion: version,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(check));

    return version;
  } catch {
    // Network errors are fine — silent no-op.
    return null;
  }
}

function isNewer(remote: string, current: string): boolean {
  const r = remote.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (c[i] || 0)) return true;
    if ((r[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}
