// GitHub step — PAT is the default path (works today, no registered OAuth
// app needed). Device flow is offered as "preferred when available", and
// only when the installed build has a real client id wired up.

import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
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
import * as github from "../../services/github";
import { upsertIntegration } from "../../services/db";

type Mode = "pat" | "device";

export function StepGitHub({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip?: () => void;
}) {
  const [mode, setMode] = useState<Mode>("pat");
  const [pat, setPat] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "ok" | "err">("idle");
  const [error, setError] = useState("");
  const [login, setLogin] = useState("");
  const [device, setDevice] = useState<github.DeviceCodeResponse | null>(null);

  // The device-flow path is only "available" when the build has a real
  // client id. The placeholder ships until the founder registers an OAuth
  // app — in that case we still show the tab, but as a quiet future state.
  const deviceFlowAvailable =
    !github.GITHUB_CLIENT_ID.startsWith("Iv1.keepr-placeholder");

  const savePAT = async () => {
    setState("testing");
    setError("");
    try {
      await github.savePAT(pat.trim());
      const viewer = await github.getViewer();
      setLogin(viewer.login);
      await upsertIntegration("github", { login: viewer.login });
      setState("ok");
    } catch (e: any) {
      setState("err");
      const raw = (e?.message || "").toLowerCase();
      if (raw.includes("401") || raw.includes("bad credentials")) {
        setError("GitHub rejected that token. Double-check the scopes include repo and read:user.");
      } else {
        setError(e?.message || "Token test failed.");
      }
    }
  };

  const startDevice = async () => {
    setState("testing");
    setError("");
    try {
      const d = await github.startDeviceFlow();
      setDevice(d);
      openExternal(d.verification_uri);
      await github.pollDeviceFlow(d.device_code, d.interval);
      const viewer = await github.getViewer();
      setLogin(viewer.login);
      await upsertIntegration("github", { login: viewer.login });
      setState("ok");
    } catch (e: any) {
      setState("err");
      setError(e?.message || "Device flow failed.");
    }
  };

  return (
    <div>
      <Title>Connect GitHub.</Title>
      <Lede>
        Keepr reads pull requests and reviews from the repos you pick. Use a
        personal access token today — it's the path that works without any
        extra setup. Device flow lights up once Keepr's OAuth app is
        registered.
      </Lede>

      <div className="mb-6 grid grid-cols-2 gap-2">
        <ModeCard
          active={mode === "pat"}
          onClick={() => {
            setMode("pat");
            setState("idle");
          }}
          badge="Default"
          title="Personal access token"
          blurb="Paste a token with repo + read:user scopes. Works today."
        />
        <ModeCard
          active={mode === "device"}
          disabled={!deviceFlowAvailable}
          onClick={() => {
            if (!deviceFlowAvailable) return;
            setMode("device");
            setState("idle");
          }}
          badge={deviceFlowAvailable ? "Preferred" : "Not yet available"}
          title="Device flow"
          blurb={
            deviceFlowAvailable
              ? "One-click: Keepr opens GitHub, you enter a short code, done."
              : "Lights up once the Keepr OAuth app is registered."
          }
        />
      </div>

      {mode === "pat" && (
        <>
          <Field
            label="GitHub personal access token"
            hint={
              <button
                className="text-accent hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  openExternal(
                    "https://github.com/settings/tokens/new?scopes=repo,read:user&description=Keepr"
                  );
                }}
              >
                Create one (scopes: repo, read:user)
              </button>
            }
          >
            <Input
              type="password"
              value={pat}
              onChange={(e) => {
                setPat(e.target.value);
                if (state !== "idle") setState("idle");
              }}
              placeholder="ghp_…"
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
              onClick={savePAT}
              disabled={!pat.trim() || state === "testing"}
            >
              {state === "testing" ? "Testing…" : "Test & save"}
            </PrimaryButton>
            <StatusLine
              state={state}
              message={state === "ok" ? `Connected as ${login}.` : error}
            />
          </StepFooter>
        </>
      )}

      {mode === "device" && (
        <>
          {device ? (
            <div className="mb-4 rounded-md border border-hairline bg-surface/50 p-4">
              <div className="text-xxs uppercase tracking-[0.14em] text-ink-faint">
                Enter this code in your browser
              </div>
              <div className="mono mt-2 text-2xl tracking-[0.22em] text-ink">
                {device.user_code}
              </div>
              <div className="mt-2 text-xxs text-ink-faint">
                Keepr opened {new URL(device.verification_uri).host} for you.
              </div>
            </div>
          ) : (
            <Lede>
              Click start. Keepr will open github.com and wait while you
              paste a short code.
            </Lede>
          )}

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
              onClick={startDevice}
              disabled={state === "testing"}
            >
              {state === "testing"
                ? device
                  ? "Waiting for GitHub…"
                  : "Starting…"
                : "Start device flow"}
            </PrimaryButton>
            <StatusLine
              state={state}
              message={state === "ok" ? `Connected as ${login}.` : error}
            />
          </StepFooter>
        </>
      )}
    </div>
  );
}

function ModeCard({
  active,
  disabled,
  onClick,
  badge,
  title,
  blurb,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  badge: string;
  title: string;
  blurb: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3 py-3 text-left text-sm transition-all duration-180 ${
        active
          ? "border-ink/45 bg-sunken"
          : disabled
          ? "border-hairline bg-canvas opacity-50 cursor-not-allowed"
          : "border-hairline bg-canvas hover:border-ink/15"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="font-medium text-ink">{title}</div>
        <span className="text-[9px] uppercase tracking-[0.14em] text-ink-faint">
          {badge}
        </span>
      </div>
      <div className="mt-[4px] text-xxs leading-snug text-ink-faint">
        {blurb}
      </div>
    </button>
  );
}
