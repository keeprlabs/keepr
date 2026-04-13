// Shared primitives for the onboarding steps. Granola-quiet: Inter + a
// single serif display for titles, hairline borders, one accent, a lot of
// whitespace. Every screen should feel like a single decision.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Title({ children }: { children: ReactNode }) {
  return (
    <h1 className="display-serif mb-3 text-[36px] leading-[1.12] text-ink tracking-[-0.01em]">
      {children}
    </h1>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className="mb-8 max-w-[54ch] text-md text-ink-muted">{children}</p>;
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <label className={`mb-4 block ${className || ""}`}>
      <span className="mb-1 block text-xs font-medium text-ink-muted">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xxs text-ink-faint">{hint}</span>
      )}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-ghost focus:border-ink/25 focus:outline-none transition-colors duration-180";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`${inputCls} ${props.className || ""}`}
    />
  );
}

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas transition-all duration-180 ease-calm hover:bg-ink-soft disabled:opacity-40 disabled:hover:bg-ink ${props.className || ""}`}
    />
  );
}

export function GhostButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 rounded-md border border-hairline bg-canvas px-4 py-2 text-sm text-ink-soft transition-all duration-180 ease-calm hover:border-ink/20 hover:text-ink disabled:opacity-40 ${props.className || ""}`}
    />
  );
}

// Quiet inline success / error affordance. Hand-drawn status line rather
// than toast theatre — the user stays on the page.
export function StatusLine({
  state,
  message,
}: {
  state: "idle" | "testing" | "ok" | "err";
  message?: string;
}) {
  if (state === "idle") return null;
  if (state === "testing") {
    return (
      <span className="text-sm text-ink-faint breathing">Testing…</span>
    );
  }
  if (state === "ok") {
    return (
      <span className="flex items-center gap-2 text-sm text-ink-muted">
        <Check />
        {message || "Verified."}
      </span>
    );
  }
  return (
    <span className="flex items-start gap-2 text-sm text-ink-soft">
      <Cross />
      <span className="leading-snug">{message}</span>
    </span>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M3 8.5l3.5 3.5L13 5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Cross() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// A footer row that keeps the primary/secondary rhythm consistent across
// steps. Left: the main action. Right: the quiet "continue" affordance.
export function StepFooter({
  children,
  right,
}: {
  children?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mt-6 flex items-center gap-3">
      {children}
      <div className="flex-1" />
      {right}
    </div>
  );
}
