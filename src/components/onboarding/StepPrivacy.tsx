// Privacy consent — honest tone from the design doc. Two actual trust
// edges: the integrations you already have (Slack, GitHub) and the LLM
// provider you picked. Say so, don't bury it.

import { useState } from "react";
import { Lede, PrimaryButton, Title } from "./primitives";
import { setConfig } from "../../services/db";

export function StepPrivacy({ onDone }: { onDone: () => void }) {
  const [ok, setOk] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const finish = async () => {
    setFinishing(true);
    await setConfig({
      privacy_consent_at: new Date().toISOString(),
      onboarded_at: new Date().toISOString(),
    });
    onDone();
  };

  return (
    <div>
      <Title>Before we start thinking together.</Title>
      <Lede>
        Keepr runs on your laptop. The session files and memory live in a
        directory you chose. There's no Keepr server, no telemetry, no
        analytics. Two things still leave your machine when you run a
        workflow — we want you to see them clearly.
      </Lede>

      <div className="mb-6 space-y-3">
        <TrustCard
          title="Slack, GitHub, Jira &amp; Linear"
          body="You already trust these services with this data. Keepr only reads the channels, repos, projects, and teams you select in Settings, using the tokens you provided."
        />
        <TrustCard
          title="Your chosen LLM provider"
          body="Raw Slack messages and PR bodies flow to the provider whose key you configured (Anthropic, OpenAI, or OpenRouter). This is the trust edge that local-first can't erase — your data reaches the model. No Keepr middleman sits in front of it."
        />
      </div>

      <label className="mb-6 flex items-start gap-3 text-sm text-ink-soft cursor-pointer">
        <input
          type="checkbox"
          checked={ok}
          onChange={(e) => setOk(e.target.checked)}
          className="mt-[3px] accent-ink"
        />
        <span className="leading-snug">
          I understand. My Slack, GitHub, Jira &amp; Linear data is sent to the
          LLM provider I configured when I run a workflow. No vendor sits in
          the middle, and no copy is kept outside my laptop.
        </span>
      </label>

      <PrimaryButton onClick={finish} disabled={!ok || finishing}>
        {finishing ? "Starting Keepr…" : "Start using Keepr"}
      </PrimaryButton>
    </div>
  );
}

function TrustCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-hairline bg-canvas p-4">
      <div
        className="text-sm font-medium text-ink mb-1"
        dangerouslySetInnerHTML={{ __html: title }}
      />
      <div className="text-xs leading-relaxed text-ink-muted">{body}</div>
    </div>
  );
}
