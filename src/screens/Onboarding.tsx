// Onboarding — a quiet composition of single-decision pages.
//
// Two flows branch from the welcome screen:
//
//   Real:  welcome → llm → slack → github → team → memory → privacy
//   Demo:  welcome → llm → demo-ready
//
// Each step is a self-contained component under src/components/onboarding/
// and this file is the router that stitches them together. The progress
// rail at the top reflects the active flow so the demo path never looks
// like it's "skipping" six steps — it's a different (shorter) journey.

import { useState } from "react";
import { StepWelcome } from "../components/onboarding/StepWelcome";
import { StepLLM } from "../components/onboarding/StepLLM";
import { StepSlack } from "../components/onboarding/StepSlack";
import { StepGitHub } from "../components/onboarding/StepGitHub";
import { StepJira } from "../components/onboarding/StepJira";
import { StepLinear } from "../components/onboarding/StepLinear";
import { StepTeam } from "../components/onboarding/StepTeam";
import { StepRubric } from "../components/onboarding/StepRubric";
import { StepMemory } from "../components/onboarding/StepMemory";
import { StepPrivacy } from "../components/onboarding/StepPrivacy";
import { StepDemoReady } from "../components/onboarding/StepDemoReady";

type Flow = "choose" | "real" | "demo";

// Ordered step slugs for each flow.
const REAL_STEPS = [
  "llm",
  "slack",
  "github",
  "jira",
  "linear",
  "team",
  "rubric",
  "memory",
  "privacy",
] as const;
type RealStep = (typeof REAL_STEPS)[number];

const REAL_LABELS: Record<RealStep, string> = {
  llm: "Model",
  slack: "Slack",
  github: "GitHub",
  jira: "Jira",
  linear: "Linear",
  team: "Team",
  rubric: "Rubric",
  memory: "Memory",
  privacy: "Privacy",
};

const DEMO_STEPS = ["llm", "ready"] as const;
type DemoStep = (typeof DEMO_STEPS)[number];

const DEMO_LABELS: Record<DemoStep, string> = {
  llm: "Model",
  ready: "Demo",
};

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [flow, setFlow] = useState<Flow>("choose");
  const [realStep, setRealStep] = useState<RealStep>("llm");
  const [demoStep, setDemoStep] = useState<DemoStep>("llm");

  const goNextReal = () => {
    const idx = REAL_STEPS.indexOf(realStep);
    if (idx < REAL_STEPS.length - 1) setRealStep(REAL_STEPS[idx + 1]);
  };
  const goNextDemo = () => {
    const idx = DEMO_STEPS.indexOf(demoStep);
    if (idx < DEMO_STEPS.length - 1) setDemoStep(DEMO_STEPS[idx + 1]);
  };
  // Back is a no-op at step 0. Field state inside each Step component is
  // re-hydrated from secrets/config on mount (see StepSlack:56, StepLLM,
  // StepGitHub etc.), so going Back to a previously saved step restores
  // the committed values. Unsaved drafts on the current step are lost on
  // unmount — that's acceptable for Phase 1.
  const goBackReal = () => {
    const idx = REAL_STEPS.indexOf(realStep);
    if (idx > 0) setRealStep(REAL_STEPS[idx - 1]);
  };
  const goBackDemo = () => {
    const idx = DEMO_STEPS.indexOf(demoStep);
    if (idx > 0) setDemoStep(DEMO_STEPS[idx - 1]);
  };
  const canBack =
    flow === "real"
      ? REAL_STEPS.indexOf(realStep) > 0
      : DEMO_STEPS.indexOf(demoStep) > 0;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="mx-auto flex w-full max-w-[680px] flex-1 flex-col overflow-y-auto px-10 pt-20 pb-16">
        {flow !== "choose" && (
          <ProgressRail
            flow={flow}
            realStep={realStep}
            demoStep={demoStep}
            canBack={canBack}
            onBack={flow === "real" ? goBackReal : goBackDemo}
            onReset={() => {
              setFlow("choose");
              setRealStep("llm");
              setDemoStep("llm");
            }}
          />
        )}

        <div className="rise" key={`${flow}:${realStep}:${demoStep}`}>
          {flow === "choose" && (
            <StepWelcome
              onStartReal={() => setFlow("real")}
              onStartDemo={() => setFlow("demo")}
            />
          )}

          {flow === "real" && realStep === "llm" && (
            <StepLLM onNext={goNextReal} />
          )}
          {flow === "real" && realStep === "slack" && (
            <StepSlack onNext={goNextReal} onSkip={goNextReal} />
          )}
          {flow === "real" && realStep === "github" && (
            <StepGitHub onNext={goNextReal} onSkip={goNextReal} />
          )}
          {flow === "real" && realStep === "jira" && (
            <StepJira onNext={goNextReal} onSkip={goNextReal} />
          )}
          {flow === "real" && realStep === "linear" && (
            <StepLinear onNext={goNextReal} onSkip={goNextReal} />
          )}
          {flow === "real" && realStep === "team" && (
            <StepTeam onNext={goNextReal} />
          )}
          {flow === "real" && realStep === "rubric" && (
            <StepRubric onNext={goNextReal} onSkip={goNextReal} />
          )}
          {flow === "real" && realStep === "memory" && (
            <StepMemory onNext={goNextReal} />
          )}
          {flow === "real" && realStep === "privacy" && (
            <StepPrivacy onDone={onDone} />
          )}

          {flow === "demo" && demoStep === "llm" && (
            <StepLLM onNext={goNextDemo} />
          )}
          {flow === "demo" && demoStep === "ready" && (
            <StepDemoReady
              onDone={onDone}
              onBack={() => setDemoStep("llm")}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Progress rail -------------------------------------------------------

function ProgressRail({
  flow,
  realStep,
  demoStep,
  canBack,
  onBack,
  onReset,
}: {
  flow: Flow;
  realStep: RealStep;
  demoStep: DemoStep;
  canBack: boolean;
  onBack: () => void;
  onReset: () => void;
}) {
  const steps =
    flow === "real"
      ? REAL_STEPS.map((s) => ({ id: s, label: REAL_LABELS[s] }))
      : DEMO_STEPS.map((s) => ({ id: s, label: DEMO_LABELS[s] }));

  const currentIdx =
    flow === "real"
      ? REAL_STEPS.indexOf(realStep)
      : DEMO_STEPS.indexOf(demoStep);

  return (
    <div className="mb-10 flex items-center gap-3 text-xxs uppercase tracking-[0.14em] text-ink-faint">
      <button
        onClick={onReset}
        className="text-ink-faint hover:text-ink transition-colors"
        title="Back to welcome"
      >
        ← Keepr
      </button>
      {canBack && (
        <>
          <span className="text-ink-ghost">·</span>
          <button
            onClick={onBack}
            className="text-ink-faint hover:text-ink transition-colors"
            title="Previous step"
          >
            ← Back
          </button>
        </>
      )}
      <span className="text-ink-ghost">·</span>
      {flow === "demo" && (
        <>
          <span className="text-ink-muted">Demo setup</span>
          <span className="text-ink-ghost">·</span>
        </>
      )}
      <div className="flex items-center gap-3">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-3">
            <span
              className={
                i === currentIdx
                  ? "text-ink"
                  : i < currentIdx
                  ? "text-ink-muted"
                  : ""
              }
            >
              {String(i + 1).padStart(2, "0")} {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-ink-ghost">·</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
