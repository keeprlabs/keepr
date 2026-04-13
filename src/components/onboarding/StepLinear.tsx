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

      <StepFooter right={<GhostButton onClick={onSkip}>Skip</GhostButton>}>
        {status === "ok" ? (
          <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
        ) : (
          <PrimaryButton onClick={test} disabled={!key.trim()}>
            Test connection
          </PrimaryButton>
        )}
      </StepFooter>
    </>
  );
}
