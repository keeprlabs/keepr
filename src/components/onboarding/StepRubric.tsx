// Engineering rubric step — optional, paste-your-ladder as markdown.
// Used by perf evaluation and promo readiness. Skippable.

import { useState } from "react";
import {
  GhostButton,
  Lede,
  PrimaryButton,
  StepFooter,
  Title,
} from "./primitives";
import { getConfig, setConfig } from "../../services/db";

export function StepRubric({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const [rubric, setRubric] = useState("");
  const [saved, setSaved] = useState(false);

  // Load existing rubric on mount.
  useState(() => {
    (async () => {
      const cfg = await getConfig();
      if (cfg.engineering_rubric) setRubric(cfg.engineering_rubric);
    })();
  });

  const save = async () => {
    await setConfig({ engineering_rubric: rubric.trim() || null });
    setSaved(true);
    setTimeout(() => onNext(), 400);
  };

  return (
    <div>
      <Title>Paste your engineering ladder.</Title>
      <Lede>
        Optional. If you have a rubric (L3, L4, L5, etc.), paste it as
        markdown below. Keepr uses it to organize perf evaluations and promo
        readiness reports by rubric dimension. You can always add or edit
        this later in Settings.
      </Lede>

      <textarea
        className="w-full rounded-md border border-hairline bg-canvas px-4 py-3 text-sm text-ink font-mono leading-relaxed placeholder:text-ink-ghost focus:border-ink/25 focus:outline-none transition-colors duration-180 min-h-[200px] resize-y"
        value={rubric}
        onChange={(e) => {
          setRubric(e.target.value);
          if (saved) setSaved(false);
        }}
        placeholder={`# Engineering Ladder

## L3 — Mid-level Engineer
- Technical execution: Delivers well-scoped tasks independently...
- Collaboration: Participates actively in code reviews...

## L4 — Senior Engineer
- Technical execution: Leads design of medium-complexity systems...
- Collaboration: Mentors junior engineers, runs design reviews...

## L5 — Staff Engineer
- Technical execution: Owns cross-team technical strategy...
- Collaboration: Shapes engineering culture and standards...`}
      />

      <StepFooter
        right={
          <GhostButton onClick={onSkip}>
            Skip for now →
          </GhostButton>
        }
      >
        <PrimaryButton onClick={save} disabled={!rubric.trim()}>
          {saved ? "Saved" : "Save & continue"}
        </PrimaryButton>
      </StepFooter>
    </div>
  );
}
