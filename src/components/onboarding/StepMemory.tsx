// Memory directory — default to ~/Documents/Keepr with a short rationale
// for WHY it's plain markdown on disk (Obsidian, grep, git, yours).

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Field,
  GhostButton,
  Input,
  Lede,
  PrimaryButton,
  StepFooter,
  Title,
} from "./primitives";
import { getConfig, setConfig } from "../../services/db";
import { defaultMemoryDir, ensureDir } from "../../services/fsio";

export function StepMemory({ onNext }: { onNext: () => void }) {
  const [dir, setDir] = useState("");
  const [defaultDir, setDefaultDir] = useState("");

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      const def = await defaultMemoryDir();
      setDefaultDir(def);
      setDir(cfg.memory_dir || def);
    })();
  }, []);

  const pick = async () => {
    const chosen = await openDialog({ directory: true, multiple: false });
    if (typeof chosen === "string") setDir(chosen);
  };

  const save = async () => {
    await ensureDir(dir);
    await setConfig({ memory_dir: dir });
    onNext();
  };

  const isDefault = dir === defaultDir;

  return (
    <div>
      <Title>Where should memory live?</Title>
      <Lede>
        Keepr writes plain markdown here — <em>status.md</em>, <em>memory.md</em>,{" "}
        one file per session, one per person. No database, no vendor lock-in.
        Open them in Obsidian, grep them in a terminal, commit them to a
        private git repo. They're yours.
      </Lede>

      <Field
        label="Memory directory"
        hint={
          isDefault
            ? "Recommended default. Lives alongside your other Documents so Time Machine backs it up automatically."
            : "Custom location — make sure it's backed up somewhere you trust."
        }
      >
        <div className="flex gap-2">
          <Input
            value={dir}
            onChange={(e) => setDir(e.target.value)}
            spellCheck={false}
            className="mono text-xs"
          />
          <GhostButton onClick={pick}>Browse…</GhostButton>
        </div>
      </Field>

      <div className="mt-8 rounded-md border border-hairline bg-surface/40 p-4">
        <div className="text-xxs uppercase tracking-[0.14em] text-ink-faint mb-2">
          What gets written there
        </div>
        <ul className="space-y-1 text-xs text-ink-muted">
          <li>
            <span className="mono text-ink-soft">status.md</span> — the
            latest team pulse, plus a <em>Manual notes</em> section Keepr
            never touches.
          </li>
          <li>
            <span className="mono text-ink-soft">memory.md</span> — a
            rolling log of every session, append-only.
          </li>
          <li>
            <span className="mono text-ink-soft">sessions/</span> — one
            markdown file per run, with citations.
          </li>
          <li>
            <span className="mono text-ink-soft">people/</span> — one
            file per engineer, observed facts only.
          </li>
        </ul>
      </div>

      <StepFooter>
        <PrimaryButton onClick={save} disabled={!dir}>
          Save &amp; continue →
        </PrimaryButton>
      </StepFooter>
    </div>
  );
}
