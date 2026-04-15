// Slack BYO-app — inline manifest, copy + download, step-by-step matching
// Slack's current "From a manifest" UI.

import { useEffect, useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
// Webview clipboard API — no extra Tauri plugin required.
const writeText = (text: string) => navigator.clipboard.writeText(text);
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Field,
  GhostButton,
  Input,
  Lede,
  PrimaryButton,
  StatusLine,
  StepFooter,
  Title,
} from "./primitives";
import { SECRET_KEYS, getSecret, setSecret } from "../../services/secrets";
import { upsertIntegration } from "../../services/db";
import * as slack from "../../services/slack";

export const MANIFEST_YAML = `display_information:
  name: Keepr (internal)
  description: Local AI memory layer reading public channels for team pulse
  background_color: "#0a0a0a"
features:
  bot_user:
    display_name: Keepr
    always_online: false
oauth_config:
  scopes:
    bot:
      - channels:history
      - channels:read
      - users:read
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false`;

export function StepSlack({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip?: () => void;
}) {
  const [token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "ok" | "err">("idle");
  const [team, setTeam] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const existing = await getSecret(SECRET_KEYS.slackBot);
      if (existing) setToken(existing);
    })();
  }, []);

  const test = async () => {
    setState("testing");
    setError("");
    try {
      await setSecret(SECRET_KEYS.slackBot, token.trim());
      const info = await slack.authTest();
      setTeam(info.team);
      await upsertIntegration("slack", info);
      setState("ok");
    } catch (e: any) {
      setState("err");
      const raw = (e?.message || "").toLowerCase();
      if (raw.includes("invalid_auth") || raw.includes("not_authed")) {
        setError("Slack rejected that token. Make sure you copied the Bot User OAuth Token (starts with xoxb-), not the User token.");
      } else if (raw.includes("missing_scope")) {
        setError("Token is missing scopes. Reinstall the app after updating the manifest.");
      } else {
        setError(e?.message || "Slack auth.test failed.");
      }
    }
  };

  const copyManifest = async () => {
    try {
      await writeText(MANIFEST_YAML);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard plugin may not be installed; the visible text is still
      // selectable as a fallback.
    }
  };

  const downloadManifest = async () => {
    try {
      const path = await saveDialog({
        defaultPath: "keepr-slack-manifest.yml",
        filters: [{ name: "YAML", extensions: ["yml", "yaml"] }],
      });
      if (typeof path === "string") {
        await writeTextFile(path, MANIFEST_YAML);
      }
    } catch {
      // non-fatal
    }
  };

  return (
    <div>
      <Title>Bring your own Slack app.</Title>
      <Lede>
        Keepr doesn't distribute a Slack app — you install one inside your
        own workspace, so your bot token stays between you and Slack.
        About two minutes.
      </Lede>

      <ol className="mb-5 space-y-3 text-sm text-ink-soft">
        <NumberedStep n={1}>
          Open{" "}
          <button
            className="text-accent hover:underline"
            onClick={() => openExternal("https://api.slack.com/apps?new_app=1")}
          >
            api.slack.com/apps
          </button>{" "}
          and click <em>Create New App → From a manifest</em>.
        </NumberedStep>
        <NumberedStep n={2}>
          Pick your workspace, then paste the manifest below and click
          through <em>Next → Create</em>.
        </NumberedStep>
        <NumberedStep n={3}>
          On the app page, click <em>Install to Workspace</em> and approve.
        </NumberedStep>
        <NumberedStep n={4}>
          Open <em>OAuth &amp; Permissions</em>, copy the{" "}
          <span className="mono text-xs">Bot User OAuth Token</span>{" "}
          (starts with <code>xoxb-</code>), and paste it below.
        </NumberedStep>
      </ol>

      <div className="mb-6 rounded-md border border-hairline bg-surface/50">
        <div className="flex items-center justify-between px-3 py-2 hair-b">
          <span className="text-xxs uppercase tracking-[0.14em] text-ink-faint">
            manifest.yml
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={copyManifest}
              className="text-xxs text-ink-muted hover:text-ink transition-colors"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <span className="text-ink-ghost">·</span>
            <button
              onClick={downloadManifest}
              className="text-xxs text-ink-muted hover:text-ink transition-colors"
            >
              Download
            </button>
          </div>
        </div>
        <pre className="mono max-h-[180px] overflow-auto whitespace-pre px-3 py-3 text-[11px] leading-relaxed text-ink-soft">
{MANIFEST_YAML}
        </pre>
      </div>

      <Field label="Slack bot token">
        <Input
          type="password"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            if (state !== "idle") setState("idle");
          }}
          placeholder="xoxb-…"
        />
      </Field>

      <StepFooter
        right={
          <div className="flex items-center gap-2">
            {onSkip && (
              <button
                onClick={onSkip}
                className="text-xs text-ink-faint hover:text-ink transition-colors"
              >
                Skip for now
              </button>
            )}
            <GhostButton disabled={state !== "ok"} onClick={onNext}>
              Continue →
            </GhostButton>
          </div>
        }
      >
        <PrimaryButton
          onClick={test}
          disabled={!token.trim() || state === "testing"}
        >
          {state === "testing" ? "Testing…" : "Test & save"}
        </PrimaryButton>
        <StatusLine
          state={state}
          message={state === "ok" ? `Connected to ${team}.` : error}
        />
      </StepFooter>
    </div>
  );
}

function NumberedStep({
  n,
  children,
}: {
  n: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mono mt-[2px] w-5 flex-shrink-0 text-xxs text-ink-faint">
        {String(n).padStart(2, "0")}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
