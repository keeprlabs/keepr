// MemoryFirstLaunchBanner — first-launch primer for the v0.2.7 memory layer.
//
// Renders once per install, the first time both:
//   1. memory_status reports "ready" (daemon up + client connected), AND
//   2. app_config.memory_first_launch_seen is false.
//
// Dismissed via "Got it" button → sets memory_first_launch_seen = true.
// Background-friendly: no blocking modal, no animation, no toast — just
// a quiet header strip that sits above the main view.
//
// PR 11 of v0.2.7.

import { useEffect, useState } from "react";
import { getConfig, setConfig } from "../services/db";
import { isReady, memoryStatus, type DaemonState } from "../services/ctxStore";

type BannerState = "hidden" | "visible";

export function MemoryFirstLaunchBanner() {
  const [bannerState, setBannerState] = useState<BannerState>("hidden");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getConfig();
        if (cfg.memory_first_launch_seen) {
          if (!cancelled) setBannerState("hidden");
          return;
        }
        // Wait for the daemon to report Ready before showing the banner —
        // otherwise we'd promise a feature that's still booting.
        const status: DaemonState = await memoryStatus();
        if (cancelled) return;
        if (isReady(status)) {
          setBannerState("visible");
        } else {
          // Try once more after a short delay; if the daemon is offline
          // at first launch we don't want the banner to nag forever, so
          // bail and let the next app start retry.
          setTimeout(async () => {
            if (cancelled) return;
            try {
              const status2 = await memoryStatus();
              if (!cancelled && isReady(status2)) {
                setBannerState("visible");
              }
            } catch {
              /* swallow — banner just stays hidden this session */
            }
          }, 3000);
        }
      } catch {
        // If db read fails, don't surface the banner — degrade silently.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (bannerState !== "visible") return null;

  const dismiss = async () => {
    try {
      await setConfig({ memory_first_launch_seen: true });
    } catch {
      /* even if persistence fails, hide for this session */
    }
    setBannerState("hidden");
  };

  return (
    <div
      role="region"
      aria-label="Memory layer first-launch banner"
      className="hair-b flex items-start gap-4 bg-[rgba(10,10,10,0.025)] px-8 py-3"
    >
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Memory layer is on
        </div>
        <div className="mt-1 text-xs text-ink-soft">
          Keepr now keeps a local memory of every session, person fact,
          and topic note alongside your markdown files. Use{" "}
          <kbd className="kbd">⌘K</kbd> or the search screen to find anything
          across your history. Older sessions appear after the v0.4 import.
        </div>
      </div>
      <button
        onClick={() => void dismiss()}
        className="shrink-0 rounded border border-hairline px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-ink-soft hover:text-ink hover:border-ink/40 transition-colors duration-180"
      >
        Got it
      </button>
    </div>
  );
}
