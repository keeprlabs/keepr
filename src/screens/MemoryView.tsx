// A quiet view for status.md / memory.md / people/*.md. Read-only in v1;
// the user can edit the files directly in their editor of choice — Keepr
// picks up changes on next read.

import { useEffect, useState } from "react";
import { join } from "@tauri-apps/api/path";
import { getConfig } from "../services/db";
import { readFileIfExists } from "../services/fsio";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  relPath: string; // e.g. "status.md", "memory.md", "people/sarah.md"
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
          <EmptyState />
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

function EmptyState() {
  return (
    <div className="py-8">
      <div className="text-xxs uppercase tracking-[0.14em] text-ink-faint">
        Nothing here yet
      </div>
      <p className="display-serif mt-3 text-[22px] leading-[1.25] text-ink-muted">
        Run a team pulse and Keepr will begin
        <br />
        composing this file for you.
      </p>
      <div className="mt-6 flex items-center gap-2 text-xs text-ink-faint">
        <span className="mono">⌘K</span>
        <span>to open the command palette</span>
      </div>
    </div>
  );
}
