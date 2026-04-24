// Onboarding step: Linear connection.
// User provides their Linear personal API key.

import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { SECRET_KEYS, setSecret } from "../../services/secrets";
import { upsertIntegration } from "../../services/db";
import * as linear from "../../services/linear";
import {
  Title,
  Lede,
  Field,
  Input,
  PrimaryButton,
  GhostButton,
  StatusLine,
  StepFooter,
} from "./primitives";
import { ScopePickerPanel } from "./ScopePickerPanel";

export function StepLinear({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");
  const [scopeCount, setScopeCount] = useState(0);

  const test = async () => {
    if (!key.trim()) return;
    setStatus("testing");
    try {
      await setSecret(SECRET_KEYS.linear, key.trim());
      const result = await linear.testConnection();
      await upsertIntegration("linear", { name: result.name, email: result.email });
      setStatus("ok");
    } catch (e: any) {
      setStatus("err");
      setErrMsg(e?.message || "Connection failed");
    }
  };

  return (
    <>
      <Title>Connect Linear</Title>
      <Lede>
        Optional. Connect Linear to pull issue tracking context into your
        workflows.
      </Lede>

      <Field
        label="Personal API key"
        hint={
          <span>
            Generate one at{" "}
            <button
              className="underline hover:text-ink"
              onClick={() => openExternal("https://linear.app/settings/api")}
            >
              linear.app/settings/api
            </button>
          </span>
        }
      >
        <Input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="lin_api_..."
        />
      </Field>

      <StatusLine state={status} message={status === "err" ? errMsg : "Connected."} />

      {status === "ok" && (
        <ScopePickerPanel
          integration="linear"
          onSelectedCountChange={setScopeCount}
        />
      )}

      <StepFooter right={<GhostButton onClick={onSkip}>Skip</GhostButton>}>
        {status === "ok" ? (
          <PrimaryButton
            onClick={onNext}
            disabled={scopeCount === 0}
            aria-disabled={scopeCount === 0}
            title={
              scopeCount === 0
                ? "Pick at least one team, or skip this step."
                : undefined
            }
          >
            Continue
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={test} disabled={!key.trim()}>
            Test connection
          </PrimaryButton>
        )}
      </StepFooter>
    </>
  );
}
