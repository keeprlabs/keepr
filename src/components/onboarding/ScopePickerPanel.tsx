// Shared scope-picker UI for StepSlack/StepGitHub/StepJira/StepLinear (and
// the Settings Slack+GitHub panels, once Lane C lands). Composition only —
// all behavior lives in useScopePicker.
//
// The parent step:
//   1. mounts this component only after `auth.test` succeeds (the hook
//      kicks off its fetch on mount)
//   2. reads `selectedCount` via onSelectedCountChange to gate Continue.
//
// Rendering the state machine:
//   loading → skeleton chips
//   empty   → prose + focusable Skip hint
//   error   → message + Retry + (if missing-scope) link back to manifest step
//   loaded  → filter input + chip grid (top-15 or full if expanded) +
//             optional "Show all N" link + stale-diff warnings

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChipGrid,
  FilterInput,
  GhostButton,
  ScopeSection,
  SourceChip,
} from "./primitives";
import {
  useScopePicker,
  type IntegrationKind,
  type UseScopePickerResult,
} from "./useScopePicker";

export interface ScopePickerCopy {
  title: string;
  lede: string;
  // What the unit is called in prose: "channels", "repos", "projects", "teams"
  unit: string;
  // Aria label for the chip group, e.g. "Slack channels to read"
  groupLabel: string;
  // Filter input placeholder
  filterPlaceholder: string;
  // Copy when there are zero sources at all on this integration
  emptyCopy: string;
}

const COPY: Record<IntegrationKind, ScopePickerCopy> = {
  slack: {
    title: "Pick channels to read.",
    lede: "We pre-selected your five most active public channels. Adjust freely — you can change this anytime in Settings.",
    unit: "channels",
    groupLabel: "Slack channels to read",
    filterPlaceholder: "Filter channels…",
    emptyCopy:
      "Your workspace has no public channels yet. You can connect a channel after onboarding via Settings.",
  },
  github: {
    title: "Pick repos to read.",
    lede: "We pre-selected the five repos with the most recent commits. Add or remove any — you can adjust this anytime in Settings.",
    unit: "repos",
    groupLabel: "GitHub repos to read",
    filterPlaceholder: "Filter repos…",
    emptyCopy:
      "This GitHub account has no repos yet. You can connect a repo after onboarding via Settings.",
  },
  jira: {
    title: "Pick projects to read.",
    lede: "We pre-selected the first five projects alphabetically. Adjust freely — you can change this anytime in Settings.",
    unit: "projects",
    groupLabel: "Jira projects to read",
    filterPlaceholder: "Filter projects…",
    emptyCopy:
      "This Jira site has no projects yet. You can connect a project after onboarding via Settings.",
  },
  linear: {
    title: "Pick teams to read.",
    lede: "We pre-selected the first five teams. Adjust freely — you can change this anytime in Settings.",
    unit: "teams",
    groupLabel: "Linear teams to read",
    filterPlaceholder: "Filter teams…",
    emptyCopy:
      "This Linear workspace has no teams yet. You can connect a team after onboarding via Settings.",
  },
};

export function ScopePickerPanel({
  integration,
  onSelectedCountChange,
}: {
  integration: IntegrationKind;
  onSelectedCountChange?: (count: number) => void;
}) {
  const hook = useScopePicker(integration);
  const copy = COPY[integration];
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const scrolledRef = useRef(false);

  // Notify parent whenever the selected count changes so it can gate Continue.
  useEffect(() => {
    onSelectedCountChange?.(hook.selected.size);
  }, [hook.selected.size, onSelectedCountChange]);

  // Scroll into view ONCE per panel instance, on the first idle/loading →
  // loaded edge. Avoids ripping the user back to the section top on every
  // remount (auth-fail/retry, re-test, parent re-render).
  useEffect(() => {
    if (scrolledRef.current) return;
    if (hook.state.kind !== "loaded") return;
    scrolledRef.current = true;
    sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hook.state.kind]);

  return (
    <ScopeSection
      title={copy.title}
      lede={copy.lede}
      countLabel={renderCountLabel(hook, copy)}
      onMount={(root) => {
        sectionRef.current = root;
      }}
    >
      <PanelBody hook={hook} copy={copy} />
    </ScopeSection>
  );
}

function renderCountLabel(
  hook: UseScopePickerResult,
  copy: ScopePickerCopy
): string {
  if (hook.state.kind === "loading") return `Loading ${copy.unit}…`;
  if (hook.state.kind === "empty") return `No ${copy.unit} found`;
  if (hook.state.kind === "error") return `Couldn't load ${copy.unit}`;
  if (hook.state.kind !== "loaded") return "";
  const n = hook.selected.size;
  const total = hook.items.length;
  // Drop the RECOMMENDED suffix once the user has edited — acknowledges they
  // took control. userEdited also survives a reTest round-trip.
  const suffix = hook.state.userEdited ? "" : " · RECOMMENDED";
  return `${n} / ${total} SELECTED${suffix}`;
}

function PanelBody({
  hook,
  copy,
}: {
  hook: UseScopePickerResult;
  copy: ScopePickerCopy;
}) {
  if (hook.state.kind === "loading" || hook.state.kind === "idle") {
    return <Skeleton />;
  }

  if (hook.state.kind === "empty") {
    return (
      <p className="text-sm text-ink-soft">{copy.emptyCopy}</p>
    );
  }

  if (hook.state.kind === "error") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">
          Couldn't load {copy.unit} — {hook.state.message}. Re-test the token
          above, or skip for now.
        </p>
        {hook.state.isMissingScope && (
          <p className="text-sm text-ink-soft">
            Slack rejected our <code>channels:read</code> scope. Reinstall the
            app after updating the manifest above.
          </p>
        )}
        <GhostButton onClick={() => void hook.reload()}>Retry</GhostButton>
      </div>
    );
  }

  return <LoadedBody hook={hook} copy={copy} />;
}

function LoadedBody({
  hook,
  copy,
}: {
  hook: UseScopePickerResult;
  copy: ScopePickerCopy;
}) {
  const filterRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);

  // Move focus to the filter input once — after the rise transition settles
  // so the focus ring doesn't flash during layout. Only on first mount of
  // LoadedBody per picker instance (hence the `focused` gate). Skips the
  // focus pull if the user has already tabbed somewhere meaningful during
  // the 180ms window (anywhere outside <body>/section), so keyboard users
  // aren't yanked back.
  useEffect(() => {
    if (focused) return;
    const t = setTimeout(() => {
      const active = document.activeElement;
      const userMovedFocus =
        active &&
        active !== document.body &&
        !filterRef.current?.contains(active);
      if (!userMovedFocus) filterRef.current?.focus();
      setFocused(true);
    }, 180);
    return () => clearTimeout(t);
  }, [focused]);

  const total = hook.items.length;
  const canShowAll = !hook.expanded && !hook.filter && total > 0;

  // Track which items rendered without the user having expanded — used to
  // compute "Show all N" affordance only when there's actually more to show.
  const showAllLabel = useMemo(() => {
    if (!canShowAll) return null;
    const visible = hook.visibleItems.length;
    if (visible >= total) return null;
    return `Show all ${total} ${copy.unit}`;
  }, [canShowAll, hook.visibleItems.length, total, copy.unit]);

  return (
    <div className="space-y-4">
      <FilterInput
        ref={filterRef}
        value={hook.filter}
        onChange={hook.setFilter}
        placeholder={copy.filterPlaceholder}
      />

      {hook.staleItems.length > 0 && (
        <p className="text-sm text-ink-soft">
          {hook.staleItems.map((s) => `Removed: ${s.label}`).join(" · ")}
          {" "}(no longer accessible).
        </p>
      )}

      <ChipGrid label={copy.groupLabel}>
        {hook.visibleItems.map((item) => (
          <SourceChip
            key={item.id}
            checked={hook.selected.has(item.id)}
            label={item.label}
            onClick={() => void hook.toggle(item.id)}
          />
        ))}
      </ChipGrid>

      {showAllLabel && (
        <button
          type="button"
          onClick={hook.expandAll}
          className="text-xs text-ink-muted hover:text-ink underline-offset-4 hover:underline"
        >
          {showAllLabel}
        </button>
      )}

      {hook.toggleError && (
        <p className="text-sm text-ink-soft">{hook.toggleError}</p>
      )}
    </div>
  );
}

function Skeleton() {
  // Eight grayed pill placeholders with a subtle opacity pulse.
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap gap-2"
    >
      <SkeletonStyles />
      {Array.from({ length: 8 }).map((_, i) => (
        <span
          key={i}
          className="h-6 w-[88px] rounded-full border border-hairline scope-skeleton-pulse"
        />
      ))}
    </div>
  );
}

function SkeletonStyles() {
  // Tiny injected stylesheet — keeps the animation co-located with its only
  // user instead of polluting globals.css. Safe to inject per render because
  // useRef dedupes with a module-level boolean.
  const injected = useRef(false);
  if (typeof document !== "undefined" && !injected.current) {
    const id = "scope-skeleton-pulse-style";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        @keyframes scope-skeleton-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.6; }
        }
        .scope-skeleton-pulse { animation: scope-skeleton-pulse 1.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .scope-skeleton-pulse { animation: none; opacity: 0.4; }
        }
      `;
      document.head.appendChild(style);
    }
    injected.current = true;
  }
  return null;
}
