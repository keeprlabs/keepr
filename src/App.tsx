// Top-level Keepr shell. Composes titlebar + sidebar + main view + palette
// + run overlay, and owns the minimal global state (current view, last
// session, run state).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Titlebar } from "./components/Titlebar";
import { Sidebar, type ViewKey } from "./components/Sidebar";
import { CommandPalette, type CommandAction } from "./components/CommandPalette";
import { SessionReader } from "./components/SessionReader";
import { RunOverlay, type RunState } from "./components/RunOverlay";
import { Home } from "./screens/Home";
import { Onboarding } from "./screens/Onboarding";
import { Settings } from "./screens/Settings";
import { MemoryView } from "./screens/MemoryView";
import { FirstRun } from "./components/onboarding/FirstRun";
import {
  archiveSession,
  countArchivedSessions,
  getConfig,
  getSession,
  listEvidence,
  listIntegrations,
  listMembers,
  listSessions,
  unarchiveSession,
} from "./services/db";
import { readFileIfExists, listMdFiles } from "./services/fsio";
import { runWorkflow } from "./services/pipeline";
import {
  exitDemoMode,
  isDemoMode,
  runDemoWorkflow,
} from "./services/demo";
import { join } from "@tauri-apps/api/path";
import type {
  EvidenceItem,
  Integration,
  SessionRow,
  TeamMember,
} from "./lib/types";

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [view, setView] = useState<ViewKey>({ kind: "home" });
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [runState, setRunState] = useState<RunState | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const showArchivedRef = useRef(showArchived);
  showArchivedRef.current = showArchived;
  const [archivedCount, setArchivedCount] = useState(0);

  const [currentSession, setCurrentSession] = useState<SessionRow | null>(null);
  const [currentEvidence, setCurrentEvidence] = useState<EvidenceItem[]>([]);
  const [currentMarkdown, setCurrentMarkdown] = useState<string>("");

  const refresh = useCallback(async () => {
    setSessions(await listSessions(50, showArchivedRef.current));
    setArchivedCount(await countArchivedSessions());
    setMembers(await listMembers());
    setIntegrations(await listIntegrations());
    // Load topic slugs from the topics directory
    try {
      const cfg = await getConfig();
      if (cfg.memory_dir) {
        const topicsDir = await join(cfg.memory_dir, "topics");
        const files = await listMdFiles(topicsDir);
        setTopics(files.map((f) => f.replace(/\.md$/, "")));
      }
    } catch {
      // topics dir may not exist yet
    }
  }, []);

  // Boot. Demo mode is stored alongside `onboarded_at` in app_config; when
  // it's on, the shell still boots normally but dispatches workflow runs
  // through the fixture pipeline in src/services/demo.ts.
  //
  // The boot sequence is wrapped in a timeout + try/catch so we fail loud
  // instead of sitting on a breathing splash forever when the local DB is
  // unreachable (another Keepr instance holding the lock, a corrupted file,
  // or — during development — `vite dev` without a Tauri shell).
  useEffect(() => {
    let cancelled = false;
    const BOOT_TIMEOUT_MS = 10000;
    const boot = async () => {
      const cfg = await getConfig();
      if (!cfg.onboarded_at) setNeedsOnboarding(true);
      setDemoMode(await isDemoMode());
      await refresh();
    };
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Keepr couldn't reach its local database within 10 seconds. " +
                "This usually means another copy of Keepr is running, the " +
                "database file is locked, or the app wasn't launched " +
                "through the Tauri shell (run `npx tauri dev` for development)."
            )
          ),
        BOOT_TIMEOUT_MS
      )
    );
    (async () => {
      try {
        await Promise.race([boot(), timeout]);
        if (!cancelled) setReady(true);
      } catch (err: any) {
        if (!cancelled) setBootError(err?.message || String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Load current session content when view changes.
  useEffect(() => {
    (async () => {
      if (view.kind !== "session") {
        setCurrentSession(null);
        return;
      }
      const s = await getSession(view.id);
      setCurrentSession(s);
      if (!s) return;
      setCurrentEvidence(await listEvidence(s.id));
      if (s.output_file_path) {
        const body = (await readFileIfExists(s.output_file_path)) || "";
        // Strip the trailing "## Evidence" footer — we render evidence in
        // the panel below, not inside the reading view.
        const idx = body.search(/\n---\n\n## Evidence/);
        setCurrentMarkdown(idx > 0 ? body.slice(0, idx).trim() : body);
      }
    })();
  }, [view]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setView({ kind: "settings" });
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        setSidebarOpen((o) => !o);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const runTeamPulse = useCallback(
    async (daysBack = 7) => {
      setRunState({ stage: "fetch", detail: "Starting…" });
      try {
        const runner = demoMode ? runDemoWorkflow : runWorkflow;
        const r = await runner({
          workflow: "team_pulse",
          daysBack,
          onProgress: (stage, detail) =>
            setRunState({ stage: stage as RunState["stage"], detail }),
        });
        await refresh();
        setRunState({ stage: "done" });
        setTimeout(() => {
          setRunState(null);
          setView({ kind: "session", id: r.sessionId });
        }, 500);
      } catch (err: any) {
        setRunState({ stage: "error", error: err?.message || String(err) });
      }
    },
    [refresh, demoMode]
  );

  const runOneOnOne = useCallback(
    async (member: TeamMember, daysBack = 7) => {
      setRunState({ stage: "fetch", detail: `Gathering ${member.display_name}'s week` });
      try {
        const runner = demoMode ? runDemoWorkflow : runWorkflow;
        const r = await runner({
          workflow: "one_on_one_prep",
          targetMemberId: member.id,
          daysBack,
          onProgress: (stage, detail) =>
            setRunState({ stage: stage as RunState["stage"], detail }),
        });
        await refresh();
        setRunState({ stage: "done" });
        setTimeout(() => {
          setRunState(null);
          setView({ kind: "session", id: r.sessionId });
        }, 500);
      } catch (err: any) {
        setRunState({ stage: "error", error: err?.message || String(err) });
      }
    },
    [refresh, demoMode]
  );

  const runWeeklyUpdate = useCallback(
    async (daysBack = 7) => {
      setRunState({ stage: "fetch", detail: "Starting weekly update..." });
      try {
        const runner = demoMode ? runDemoWorkflow : runWorkflow;
        const r = await runner({
          workflow: "weekly_update",
          daysBack,
          onProgress: (stage, detail) =>
            setRunState({ stage: stage as RunState["stage"], detail }),
        });
        await refresh();
        setRunState({ stage: "done" });
        setTimeout(() => {
          setRunState(null);
          setView({ kind: "session", id: r.sessionId });
        }, 500);
      } catch (err: any) {
        setRunState({ stage: "error", error: err?.message || String(err) });
      }
    },
    [refresh, demoMode]
  );

  const runPerfEval = useCallback(
    async (member: TeamMember, daysBack = 180) => {
      setRunState({ stage: "fetch", detail: `Gathering ${member.display_name}'s performance data` });
      try {
        const runner = demoMode ? runDemoWorkflow : runWorkflow;
        const r = await runner({
          workflow: "perf_evaluation",
          targetMemberId: member.id,
          daysBack,
          onProgress: (stage, detail) =>
            setRunState({ stage: stage as RunState["stage"], detail }),
        });
        await refresh();
        setRunState({ stage: "done" });
        setTimeout(() => {
          setRunState(null);
          setView({ kind: "session", id: r.sessionId });
        }, 500);
      } catch (err: any) {
        setRunState({ stage: "error", error: err?.message || String(err) });
      }
    },
    [refresh, demoMode]
  );

  const runPromoReadiness = useCallback(
    async (member: TeamMember, daysBack = 180) => {
      setRunState({ stage: "fetch", detail: `Assessing ${member.display_name}'s promo readiness` });
      try {
        const runner = demoMode ? runDemoWorkflow : runWorkflow;
        const r = await runner({
          workflow: "promo_readiness",
          targetMemberId: member.id,
          daysBack,
          onProgress: (stage, detail) =>
            setRunState({ stage: stage as RunState["stage"], detail }),
        });
        await refresh();
        setRunState({ stage: "done" });
        setTimeout(() => {
          setRunState(null);
          setView({ kind: "session", id: r.sessionId });
        }, 500);
      } catch (err: any) {
        setRunState({ stage: "error", error: err?.message || String(err) });
      }
    },
    [refresh, demoMode]
  );

  // Command palette actions.
  const actions = useMemo<CommandAction[]>(() => {
    const base: CommandAction[] = [
      {
        id: "team_pulse",
        label: "Run team pulse",
        keywords: "pulse team weekly",
        hint: "⌘⏎",
        run: () => runTeamPulse(7),
      },
      {
        id: "__runOneOnOne",
        label: "Run 1:1 prep (pick from sidebar or type name)",
        keywords: "one on one 1:1 prep",
        run: () => {},
      },
      {
        id: "weekly_update",
        label: "Run weekly engineering update",
        keywords: "weekly update status report",
        run: () => runWeeklyUpdate(7),
      },
      {
        id: "open_status",
        label: "Open status.md",
        keywords: "status memory",
        run: () => setView({ kind: "memory", file: "status" }),
      },
      {
        id: "open_memory",
        label: "Open memory.md",
        keywords: "memory log",
        run: () => setView({ kind: "memory", file: "memory" }),
      },
      {
        id: "settings",
        label: "Open settings",
        keywords: "settings preferences config",
        hint: "⌘,",
        run: () => setView({ kind: "settings" }),
      },
      {
        id: "reveal_finder",
        label: "Reveal memory directory in Finder",
        keywords: "finder reveal open directory",
        run: async () => {
          const cfg = await getConfig();
          if (cfg.memory_dir) openExternal(cfg.memory_dir);
        },
      },
    ];

    // Inject per-member workflow actions.
    for (const m of members) {
      base.push({
        id: `1on1-${m.id}`,
        label: `1:1 prep — ${m.display_name}`,
        keywords: `one on one prep ${m.display_name}`,
        run: () => runOneOnOne(m),
      });
      base.push({
        id: `perf-${m.id}`,
        label: `Perf evaluation — ${m.display_name}`,
        keywords: `perf evaluation review ${m.display_name}`,
        run: () => runPerfEval(m),
      });
      base.push({
        id: `promo-${m.id}`,
        label: `Promo readiness — ${m.display_name}`,
        keywords: `promo readiness promotion ${m.display_name}`,
        run: () => runPromoReadiness(m),
      });
    }

    return base;
  }, [members, runTeamPulse, runOneOnOne, runWeeklyUpdate, runPerfEval, runPromoReadiness]);

  // Re-fetch when showArchived toggles.
  useEffect(() => {
    if (ready) refresh();
  }, [showArchived, ready, refresh]);

  const handleArchive = useCallback(
    async (id: number) => {
      await archiveSession(id);
      // If archiving the currently-viewed session, go home.
      if (view.kind === "session" && view.id === id) {
        setView({ kind: "home" });
      }
      await refresh();
    },
    [view, refresh]
  );

  const handleUnarchive = useCallback(
    async (id: number) => {
      await unarchiveSession(id);
      await refresh();
    },
    [refresh]
  );

  if (bootError) {
    return <BootErrorScreen message={bootError} />;
  }

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas text-sm text-ink-faint breathing">
        Keepr
      </div>
    );
  }

  if (needsOnboarding) {
    return (
      <Onboarding
        onDone={async () => {
          setNeedsOnboarding(false);
          setDemoMode(await isDemoMode());
          await refresh();
        }}
      />
    );
  }

  const lastPulse = sessions.find(
    (s) => s.workflow_type === "team_pulse" && s.status === "complete"
  );
  const showFirstRun = sessions.length === 0 && view.kind === "home";

  const handleExitDemo = async () => {
    await exitDemoMode();
    setDemoMode(false);
    setNeedsOnboarding(true);
    setView({ kind: "home" });
    await refresh();
  };

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <Titlebar
        onOpenPalette={() => setPaletteOpen(true)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            sessions={sessions}
            members={members}
            topics={topics}
            view={view}
            onSelect={setView}
            integrations={integrations}
            archivedCount={archivedCount}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((o) => !o)}
            onArchive={handleArchive}
            onUnarchive={handleUnarchive}
          />
        )}
        <main className="relative flex-1 overflow-hidden">
          {view.kind === "home" && showFirstRun && (
            <FirstRun
              demoMode={demoMode}
              onOpenPalette={() => setPaletteOpen(true)}
              onRunFirstPulse={() => runTeamPulse(7)}
            />
          )}
          {view.kind === "home" && !showFirstRun && (
            <Home
              lastPulse={
                lastPulse
                  ? new Date(lastPulse.created_at).toLocaleString()
                  : null
              }
              onOpenPalette={() => setPaletteOpen(true)}
              onRunTeamPulse={() => runTeamPulse(7)}
              onRunWeeklyUpdate={() => runWeeklyUpdate(7)}
              onRunOneOnOne={runOneOnOne}
              members={members}
            />
          )}
          {view.kind === "session" && currentSession && (
            <SessionReader
              session={currentSession}
              markdown={currentMarkdown}
              evidence={currentEvidence}
              memberName={
                currentSession.target_member_id
                  ? members.find((m) => m.id === currentSession.target_member_id)
                      ?.display_name ?? null
                  : null
              }
            />
          )}
          {view.kind === "memory" && (
            <MemoryView
              relPath={view.file === "status" ? "status.md" : "memory.md"}
              title={view.file === "status" ? "status.md" : "memory.md"}
            />
          )}
          {view.kind === "person" && (
            <MemoryView
              relPath={`people/${
                members.find((m) => m.id === view.memberId)?.slug || ""
              }.md`}
              title={
                members.find((m) => m.id === view.memberId)?.display_name || ""
              }
            />
          )}
          {view.kind === "topic" && (
            <MemoryView
              relPath={`topics/${view.slug}.md`}
              title={view.slug.replace(/-/g, " ")}
            />
          )}
          {view.kind === "settings" && <Settings />}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        members={members}
        actions={actions}
        onNavigateSession={(id) => setView({ kind: "session", id })}
        onNavigateMemory={(file) => setView({ kind: "memory", file })}
      />
      <RunOverlay state={runState} onDismiss={() => setRunState(null)} />
      {demoMode && <DemoPill onExit={handleExitDemo} />}
    </div>
  );
}

// Fixed-position pill that lives in the bottom-left of the shell while
// demo mode is active. Clicking it offers the "Switch to real data" exit.
// Rendered here (rather than in Titlebar or Sidebar) to keep those
// components untouched — demo mode is additive.
function DemoPill({ onExit }: { onExit: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full border border-hairline bg-canvas px-3 py-[6px] text-xxs text-ink-soft shadow-soft">
        <span>Switch to real data? Demo will be wiped.</span>
        <button
          onClick={onExit}
          className="font-medium text-ink hover:underline"
        >
          Yes, exit
        </button>
        <span className="text-ink-ghost">·</span>
        <button
          onClick={() => setConfirming(false)}
          className="text-ink-faint hover:text-ink"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setConfirming(true)}
      className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full border border-hairline bg-canvas px-3 py-[6px] text-[10px] uppercase tracking-[0.14em] text-ink-muted shadow-soft transition-all duration-180 ease-calm hover:border-ink/25 hover:text-ink"
      title="Click to switch to real data"
    >
      <span className="inline-block h-[6px] w-[6px] rounded-full bg-ink-faint" />
      <span className="font-medium">Demo</span>
      <span className="text-ink-ghost">·</span>
      <span className="normal-case tracking-normal text-ink-faint">sample data</span>
    </button>
  );
}

// Shown when the boot sequence fails (timeout, SQLite lock, permissions,
// etc). Composed rather than alarmist. Offers the two things a user can
// actually do about it: retry, or copy details for the bug report.
function BootErrorScreen({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable; the message is already on screen.
    }
  };
  return (
    <div className="flex h-screen items-center justify-center bg-canvas px-6">
      <div className="max-w-[520px]">
        <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          Couldn't start
        </div>
        <h1 className="display-serif-lg mt-3 text-ink">Keepr hit a wall at boot.</h1>
        <p className="mt-5 text-sm leading-relaxed text-ink-muted">{message}</p>
        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas transition-all duration-180 ease-calm hover:bg-ink-soft"
          >
            Try again
          </button>
          <button
            onClick={copy}
            className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink-soft transition-all duration-180 ease-calm hover:border-ink/20 hover:text-ink"
          >
            {copied ? "Copied" : "Copy details"}
          </button>
        </div>
      </div>
    </div>
  );
}
