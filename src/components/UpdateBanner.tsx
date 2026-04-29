// Update banner — thin view layer over the updater singleton in
// services/updater.ts. State and the actual check/download logic live
// there so the Settings App panel and this banner share one in-flight
// download and one ready state (no double-fetches).

import { useEffect, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  checkForUpdate,
  getState,
  subscribe,
  type UpdaterState,
} from "../services/updater";

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function UpdateBanner() {
  const [state, setState] = useState<UpdaterState>(getState());
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribe(setState);

    // Kick off the first check on mount. Re-check every 6 hours after
    // that — so a user who keeps the app open for days still picks up
    // newer releases without restarting first. The singleton short-
    // circuits when it's already in `ready` state.
    checkForUpdate();
    const id = window.setInterval(() => {
      checkForUpdate();
    }, RECHECK_INTERVAL_MS);

    return () => {
      unsubscribe();
      window.clearInterval(id);
    };
  }, []);

  // Only render when we have something the user should act on.
  if (dismissed) return null;
  if (state.kind !== "ready" && state.kind !== "fallback") return null;

  const handleRestart = async () => {
    if (state.kind !== "ready") return;
    setRestarting(true);
    try {
      await relaunch();
    } catch (err) {
      console.error("Failed to relaunch after update install:", err);
      setRestarting(false);
    }
  };

  return (
    <div className="flex items-center justify-between bg-[rgba(47,58,76,0.06)] px-6 py-2 text-xs text-ink-muted">
      <span>
        Keepr <strong>v{state.version}</strong>{" "}
        {state.kind === "ready" ? (
          <span className="text-ink-faint">is ready to install. Restart Keepr to upgrade.</span>
        ) : (
          <span className="text-ink-faint">
            is available. Run{" "}
            <code className="rounded bg-[rgba(10,10,10,0.06)] px-1 py-0.5 text-[10px]">
              brew upgrade --cask keepr
            </code>{" "}
            to update.
          </span>
        )}
      </span>
      <div className="ml-4 flex items-center gap-3">
        {state.kind === "ready" && (
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="rounded bg-ink px-2 py-1 text-[11px] text-canvas hover:bg-ink-soft disabled:opacity-60"
          >
            {restarting ? "Restarting…" : "Restart to install"}
          </button>
        )}
        <button
          onClick={() => setDismissed(true)}
          className="text-ink-faint transition-colors duration-180 hover:text-ink"
          aria-label="Dismiss update notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}
