// A quiet view for status.md / memory.md / people/*.md. Read-only in v1;
// the user can edit the files directly in their editor of choice — Keepr
// picks up changes on next read.

import { useEffect, useState } from "react";
import { join } from "@tauri-apps/api/path";
import { getConfig } from "../services/db";
import { readFileIfExists } from "../services/fsio";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  relPath: string; // e.g. "status.md", "memory.md", "people/sarah.md", "topics/auth.md"
  title: string;
}

export function MemoryView({ relPath, title }: Props) {
  const [contents, setContents] = useState<string | null>(null);
  const [fullPath, setFullPath] = useState<string>("");

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      if (!cfg.memory_dir) {
        setContents(null);
        return;
      }
      const p = await join(cfg.memory_dir, relPath);
      setFullPath(p);
      setContents(await readFileIfExists(p));
    })();
  }, [relPath]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <div className="mx-auto w-full max-w-[68ch] px-12 pt-20 pb-16 rise">
        <div className="mb-3 mono truncate text-[10px] text-ink-faint">
          {fullPath || relPath}
        </div>
        <h1 className="display-serif-lg mb-12 text-[40px] leading-[1.05] text-ink">
          {title}
        </h1>
        {contents === null ? (
          <EmptyState relPath={relPath} />
        ) : (
          <div
            className="reading"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(contents, new Map()),
            }}
          />
        )}
      </div>
    </div>
  );
}

function emptyHint(relPath: string): { headline: string; body: string } {
  if (relPath === "status.md") {
    return {
      headline: "Status writes itself.",
      body: "After each team pulse or weekly update, Keepr overwrites this file with the latest generated output. You can add your own notes in the Manual notes section and they'll survive every regeneration.",
    };
  }
  if (relPath === "memory.md") {
    return {
      headline: "This is Keepr's long-term memory.",
      body: "After each session, observed facts are appended here. Memory persists across sessions and is yours to edit. The more you use Keepr, the sharper its output becomes.",
    };
  }
  if (relPath.startsWith("people/")) {
    return {
      headline: "No observations yet.",
      body: "Run a 1:1 prep or team pulse that includes this person. Keepr will start recording observed facts here, one session at a time.",
    };
  }
  if (relPath.startsWith("topics/")) {
    return {
      headline: "This topic hasn't been observed yet.",
      body: "Topics are created automatically when the LLM identifies recurring themes across sessions. Run a few sessions and they'll start appearing.",
    };
  }
  return {
    headline: "Nothing here yet.",
    body: "Run a workflow and Keepr will begin composing this file for you.",
  };
}

function EmptyState({ relPath }: { relPath: string }) {
  const { headline, body } = emptyHint(relPath);
  return (
    <div className="py-8">
      <div className="text-xxs uppercase tracking-[0.14em] text-ink-faint">
        Empty
      </div>
      <p className="display-serif mt-3 text-[22px] leading-[1.25] text-ink-muted">
        {headline}
      </p>
      <p className="mt-4 max-w-[52ch] text-sm leading-relaxed text-ink-faint">
        {body}
      </p>
      <div className="mt-6 flex items-center gap-2 text-xs text-ink-faint">
        <span className="mono">⌘K</span>
        <span>to open the command palette</span>
      </div>
    </div>
  );
}
