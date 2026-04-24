// Shared primitives for the onboarding steps. Granola-quiet: Inter + a
// single serif display for titles, hairline borders, one accent, a lot of
// whitespace. Every screen should feel like a single decision.

import { forwardRef, useEffect, useRef } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent,
  ReactNode,
} from "react";

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

// ---------------------------------------------------------------------------
// Scope picker primitives — used by StepSlack / StepGitHub / StepJira /
// StepLinear AND by the corresponding Settings panels (one source of truth
// for chip UX). Composition only: state lives in `useScopePicker`.
// ---------------------------------------------------------------------------

// A toggleable pill for a single source (channel / repo / project / team).
// Styles lifted verbatim from Settings.tsx:300-318. Hover darkens border
// to ink/25. The chip emits onClick — toggle semantics are owned by the
// hook, never the component.
export function SourceChip({
  checked,
  label,
  onClick,
  disabled,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-all duration-180 ease-calm disabled:opacity-40 ${
        checked
          ? "border-ink/80 bg-ink text-canvas"
          : "border-hairline text-ink-soft hover:border-ink/25 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

// Wraps a row/grid of <SourceChip>. Pure layout + group semantics.
export function ChipGrid({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {children}
    </div>
  );
}

// Filter input: thin wrapper around <Input>. Calls onChange with the
// string value (not the raw event). Escape clears and refocuses self.
// Forwards ref so parents can focus it programmatically (used by the
// scope picker's "focus-on-section-rise" behavior).
export const FilterInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
  }
>(function FilterInput({ value, onChange, placeholder }, forwardedRef) {
  const localRef = useRef<HTMLInputElement | null>(null);
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onChange("");
      localRef.current?.focus();
    }
  }
  return (
    <input
      ref={(node) => {
        localRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={inputCls}
    />
  );
});

// The shell for one scope-picker section. Renders the hairline separator,
// h2 header, lede, mono count label (aria-live so screen readers hear
// updates), and the children (filter / chip grid / show-all link).
//
// `onMount` fires once after first paint — used by the parent step to
// scroll the section into view + move focus to the filter input.
export function ScopeSection({
  title,
  lede,
  countLabel,
  onMount,
  children,
}: {
  title: string;
  lede: ReactNode;
  countLabel: ReactNode;
  onMount?: (root: HTMLDivElement) => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (rootRef.current && onMount) onMount(rootRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={rootRef}
      className="mt-8 border-t border-hairline pb-6 pt-8"
    >
      <h2 className="display-serif mb-3 text-[24px] leading-[1.2] text-ink">
        {title}
      </h2>
      <p className="mb-4 max-w-[54ch] text-md text-ink-muted">{lede}</p>
      <div
        role="status"
        aria-live="polite"
        className="mono mb-4 text-xxs uppercase tracking-[0.14em] text-ink-faint"
      >
        {countLabel}
      </div>
      {children}
    </div>
  );
}
