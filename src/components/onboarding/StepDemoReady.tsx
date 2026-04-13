// Demo-mode terminal screen — after the LLM key is verified, one final
// composed page that tells the manager exactly what will happen when
// they click "Start the demo". Sets the demo flag, seeds the fake team,
// and boots the shell.

import { useState } from "react";
import { Lede, PrimaryButton, Title } from "./primitives";
import { seedDemoData } from "../../services/demo";
import { DEMO_MEMBERS } from "../../demo/fixtures";

export function StepDemoReady({
  onDone,
  onBack,
}: {
  onDone: () => void;
  onBack: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const start = async () => {
    setStarting(true);
    setError("");
    try {
      await seedDemoData();
      onDone();
    } catch (e: any) {
      setError(e?.message || String(e));
      setStarting(false);
    }
  };

  return (
    <div>
      <div className="text-xxs uppercase tracking-[0.14em] text-ink-faint mb-4">
        Demo mode
      </div>
      <Title>Meet your pretend team.</Title>
      <Lede>
        Keepr is about to seed a synthetic workspace — five engineers,
        one week of invented Slack messages, about twenty pull requests.
        When you run a team pulse, it will hit your real LLM provider
        with this fake evidence and write the brief into a separate{" "}
        <span className="mono text-xs">~/Documents/Keepr-Demo/</span>{" "}
        directory. Your real notes, if you have any, are untouched.
      </Lede>

      <div className="mb-8 rounded-md border border-hairline bg-surface/40 p-4">
        <div className="text-xxs uppercase tracking-[0.14em] text-ink-faint mb-3">
          The cast
        </div>
        <ul className="space-y-2 text-xs text-ink-muted">
          {DEMO_MEMBERS.map((m) => (
            <li key={m.seed_id} className="flex gap-3">
              <span className="text-ink-soft w-[140px] flex-shrink-0">
                {m.display_name}
              </span>
              <span className="text-ink-faint">{m.persona}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-6 text-xxs text-ink-faint leading-relaxed">
        A full team-pulse demo call typically costs $0.02–$0.05 on Claude
        Haiku + Sonnet. You can switch back to real data at any time from
        the demo pill in the corner.
      </div>

      <div className="flex items-center gap-3">
        <PrimaryButton onClick={start} disabled={starting}>
          {starting ? "Seeding the demo…" : "Start the demo"}
        </PrimaryButton>
        <button
          onClick={onBack}
          disabled={starting}
          className="text-sm text-ink-faint hover:text-ink transition-colors"
        >
          ← back
        </button>
        {error && (
          <span className="text-sm text-ink-soft">{error}</span>
        )}
      </div>
    </div>
  );
}
