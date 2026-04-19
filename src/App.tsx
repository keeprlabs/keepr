// Top-level Keepr shell. Composes titlebar + sidebar + main view + palette
// + run overlay, and owns the minimal global state (current view, last
// session, run state).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Titlebar } from "./components/Titlebar";
import { Sidebar, type ViewKey } from "./components/Sidebar";
import { CommandPalette, type CommandAction } from "./components/CommandPalette";
import { SessionReader } from "./components/SessionReader";
import { PersonDetail } from "./components/PersonDetail";
import { RunOverlay, type RunState } from "./components/RunOverlay";
import { Home } from "./screens/Home";
import { Onboarding } from "./screens/Onboarding";
import { Settings } from "./screens/Settings";
import { MemoryView } from "./screens/MemoryView";
import { FollowUps } from "./screens/FollowUps";
import { TeamHeatmap } from "./screens/TeamHeatmap";
import { ThreadGraph } from "./screens/ThreadGraph";
import { FirstRun } from "./components/onboarding/FirstRun";
import { UpdateBanner } from "./components/UpdateBanner";
import {
  archiveSession,
  countArchivedSessions,
  deleteSession,
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
import { isAbortError } from "./lib/abort";
import { join } from "@tauri-apps/api/path";
import type {
  EvidenceItem,
  Integration,
  SessionRow,
  TeamMember,
  WorkflowType,
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
  const runControllerRef = useRef<AbortController | null>(null);
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

  // One helper that owns the AbortController lifecycle, error handling,
  // and navigate-on-complete behavior for every workflow dispatch. The
  // 5 run* wrappers below are just thin calls into this. Extracted during
  // the plan-eng-review pass when AbortSignal threading made the prior
  // copy-pasted callbacks even more duplicative.
  const runWithOverlay = useCallback(
    async (args: {
      workflow: WorkflowType;
      targetMember?: TeamMember;
      daysBack: number;
      startDetail: string;
    }) => {
      // Abort any previous in-flight run before starting a new one.
      runControllerRef.current?.abort();
      const controller = new AbortController();
      runControllerRef.current = controller;

      setRunState({ stage: "fetch", detail: args.startDetail });
      try {
        const runner = demoMode ? runDemoWorkflow : runWorkflow;
        const r = await runner({
          workflow: args.workflow,
          targetMemberId: args.targetMember?.id,
          daysBack: args.daysBack,
          signal: controller.signal,
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
        if (isAbortError(err)) {
          // User cancelled. Pipeline already deleted the session row
          // (or never created evidence). Clear state silently — no toast.
          setRunState(null);
          await refresh();
          return;
        }
        setRunState({ stage: "error", error: err?.message || String(err) });
      } finally {
        if (runControllerRef.current === controller)
          runControllerRef.current = null;
      }
    },
    [refresh, demoMode]
  );

  const cancelRun = useCallback(() => {
    runControllerRef.current?.abort();
  }, []);

  const runTeamPulse = useCallback(
    (daysBack = 7) =>
      runWithOverlay({
        workflow: "team_pulse",
        daysBack,
        startDetail: "Starting…",
      }),
    [runWithOverlay]
  );

  const runOneOnOne = useCallback(
    (member: TeamMember, daysBack = 7) =>
      runWithOverlay({
        workflow: "one_on_one_prep",
        targetMember: member,
        daysBack,
        startDetail: `Gathering ${member.display_name}'s week`,
      }),
    [runWithOverlay]
  );

  const runWeeklyUpdate = useCallback(
    (daysBack = 7) =>
      runWithOverlay({
        workflow: "weekly_update",
        daysBack,
        startDetail: "Starting weekly update…",
      }),
    [runWithOverlay]
  );

  const runPerfEval = useCallback(
    (member: TeamMember, daysBack = 180) =>
      runWithOverlay({
        workflow: "perf_evaluation",
        targetMember: member,
        daysBack,
        startDetail: `Gathering ${member.display_name}'s performance data`,
      }),
    [runWithOverlay]
  );

  const runPromoReadiness = useCallback(
    (member: TeamMember, daysBack = 180) =>
      runWithOverlay({
        workflow: "promo_readiness",
        targetMember: member,
        daysBack,
        startDetail: `Assessing ${member.display_name}'s promo readiness`,
      }),
    [runWithOverlay]
  );

  // Retry a failed session with the same workflow type, target member,
  // and a window size matching the original (rounded to whole days). The
  // new run uses "now" as the end, so the content is current — users who
  // click Try again want "fetch what happened recently", not a historical
  // replay. The old failed row is left in place until the new session
  // completes and becomes the visible one in the sidebar; users can
  // explicitly Delete it if they don't want the audit trail.
  const rerunSession = useCallback(
    (session: SessionRow) => {
      const ms =
        new Date(session.time_range_end).getTime() -
        new Date(session.time_range_start).getTime();
      const daysBack = Math.max(1, Math.round(ms / 86_400_000));
      const target =
        session.target_member_id != null
          ? members.find((m) => m.id === session.target_member_id)
          : undefined;
      switch (session.workflow_type) {
        case "team_pulse":
          return runTeamPulse(daysBack);
        case "weekly_update":
          return runWeeklyUpdate(daysBack);
        case "one_on_one_prep":
          if (target) return runOneOnOne(target, daysBack);
          break;
        case "perf_evaluation":
          if (target) return runPerfEval(target, daysBack);
          break;
        case "promo_readiness":
          if (target) return runPromoReadiness(target, daysBack);
          break;
      }
      return undefined;
    },
    [members, runTeamPulse, runOneOnOne, runWeeklyUpdate, runPerfEval, runPromoReadiness]
  );

  const deleteSessionAndRefresh = useCallback(
    async (id: number) => {
      await deleteSession(id);
      await refresh();
      setView({ kind: "home" });
    },
    [refresh]
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
      ...(members.length === 0
        ? [
            {
              id: "__setup_team",
              label: "1:1 prep — add team members first",
              keywords: "one on one 1:1 prep team members setup",
              run: () => setView({ kind: "settings" }),
            },
            {
              id: "__setup_team_perf",
              label: "Perf evaluation — add team members first",
              keywords: "perf evaluation review team members setup",
              run: () => setView({ kind: "settings" }),
            },
            {
              id: "__setup_team_promo",
              label: "Promo readiness — add team members first",
              keywords: "promo readiness promotion team members setup",
              run: () => setView({ kind: "settings" }),
            },
          ]
        : []),
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
        id: "followups",
        label: "Follow-ups",
        keywords: "follow-ups followups action items tracking",
        run: () => setView({ kind: "followups" }),
      },
      {
        id: "new_followup",
        label: "New follow-up",
        keywords: "create new follow-up action item",
        run: () => setView({ kind: "followups" }),
      },
      {
        id: "team_heatmap",
        label: "Team heatmap",
        keywords: "heatmap activity grid team members",
        run: () => setView({ kind: "heatmap" }),
      },
      {
        id: "thread_graph",
        label: "Evidence graph",
        keywords: "graph relationships threads connections",
        run: () => setView({ kind: "graph" }),
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
        <main className="relative flex-1 overflow-hidden flex flex-col">
          <UpdateBanner />
          <div className="flex-1 overflow-hidden">
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
              members={members}
              onRetry={rerunSession}
              onDelete={deleteSessionAndRefresh}
            />
          )}
          {view.kind === "memory" && (
            <MemoryView
              relPath={view.file === "status" ? "status.md" : "memory.md"}
              title={view.file === "status" ? "status.md" : "memory.md"}
            />
          )}
          {view.kind === "person" &&
            (() => {
              const m = members.find((m) => m.id === view.memberId);
              return m ? (
                <PersonDetail
                  member={m}
                  onBack={() => setView({ kind: "home" })}
                />
              ) : null;
            })()}
          {view.kind === "topic" && (
            <MemoryView
              relPath={`topics/${view.slug}.md`}
              title={view.slug.replace(/-/g, " ")}
            />
          )}
          {view.kind === "followups" && <FollowUps members={members} />}
          {view.kind === "heatmap" && <TeamHeatmap members={members} />}
          {view.kind === "graph" && <ThreadGraph members={members} />}
          {view.kind === "settings" && <Settings />}
          </div>
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
      <RunOverlay
        state={runState}
        onDismiss={() => setRunState(null)}
        onCancel={cancelRun}
      />
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
  const [copyLabel, setCopyLabel] = useState("Copy details");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopyLabel("Copied");
      setTimeout(() => setCopyLabel("Copy details"), 1800);
    } catch {
      // Clipboard may be unavailable in some webview contexts.
      // Fall back to selecting the text so the user can Cmd+C.
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        const el = document.querySelector("[data-error-text]");
        if (sel && el) {
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          setCopyLabel("Selected — ⌘C to copy");
          setTimeout(() => setCopyLabel("Copy details"), 3000);
          return;
        }
      } catch { /* fall through */ }
      setCopyLabel("Copy failed");
      setTimeout(() => setCopyLabel("Copy details"), 2000);
    }
  };
  return (
    <div className="flex h-screen items-center justify-center bg-canvas px-6">
      <div className="max-w-[520px]">
        <div className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          Couldn't start
        </div>
        <h1 className="display-serif-lg mt-3 text-ink">Keepr hit a wall at boot.</h1>
        <p className="mt-5 text-sm leading-relaxed text-ink-muted" data-error-text>{message}</p>
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
            {copyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
