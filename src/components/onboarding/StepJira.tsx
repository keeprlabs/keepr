// Onboarding step: Jira Cloud connection.
// User provides their Atlassian Cloud URL, email, and API token.

import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { setConfig } from "../../services/db";
import { SECRET_KEYS, setSecret } from "../../services/secrets";
import { upsertIntegration } from "../../services/db";
import * as jira from "../../services/jira";
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

export function StepJira({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");

  const test = async () => {
    if (!url.trim() || !email.trim() || !token.trim()) return;
    setStatus("testing");
    try {
      await setConfig({ jira_cloud_url: url.trim() });
      await setSecret(SECRET_KEYS.jiraEmail, email.trim());
      await setSecret(SECRET_KEYS.jiraToken, token.trim());
      const result = await jira.testConnection();
      await upsertIntegration("jira", { displayName: result.displayName });
      setStatus("ok");
    } catch (e: any) {
      setStatus("err");
      setErrMsg(e?.message || "Connection failed");
    }
  };

  return (
    <>
      <Title>Connect Jira</Title>
      <Lede>
        Optional. Connect your Jira Cloud instance to pull issue and sprint
        context into your workflows.
      </Lede>

      <Field label="Atlassian Cloud URL" hint="e.g. https://your-org.atlassian.net">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-org.atlassian.net"
        />
      </Field>

      <Field label="Email" hint="The email address for your Atlassian account">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </Field>

      <Field
        label="API token"
        hint={
          <span>
            Generate one at{" "}
            <button
              className="underline hover:text-ink"
              onClick={() =>
                openExternal(
                  "https://id.atlassian.com/manage-profile/security/api-tokens"
                )
              }
            >
              id.atlassian.com
            </button>
          </span>
        }
      >
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Jira API token"
        />
      </Field>

      <StatusLine state={status} message={status === "err" ? errMsg : "Connected."} />

      <StepFooter right={<GhostButton onClick={onSkip}>Skip</GhostButton>}>
        {status === "ok" ? (
          <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
        ) : (
          <PrimaryButton onClick={test} disabled={!url.trim() || !email.trim() || !token.trim()}>
            Test connection
          </PrimaryButton>
        )}
      </StepFooter>
    </>
  );
}
