// Real search-and-pick combobox for mapping a team member to a provider
// account. Replaces the native <select> dropdowns in Settings and the
// free-text inputs in StepTeam. Single component, used in both places.
//
// Behaviour:
//   - On focus: trigger onLoad once (idempotent — caches in the parent).
//   - As user types: debounce 150ms, call search(query), show top matches.
//   - Arrow-up/down to navigate, Enter or click to select. Esc closes.
//   - Once a value is picked, the input shows the resolved label with a
//     small "×" affordance to clear it. Typing again reopens search.
//   - Clearing the text input does NOT clear the value — you must hit "×".
//     This avoids the silent-overwrite class of bug.
//   - For network-backed search (GitHub), aborts in-flight on query change.
//   - resolveLabel runs once on mount when value is set without a label,
//     so reloading from DB still shows a friendly name.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { inputCls } from "./primitives";
import type { ProviderUserMatch, TeammateProvider } from "../../services/teammateSearch";

export interface UserComboboxProps {
  provider: TeammateProvider;
  /** Persisted handle (slack id, github login, jira/linear displayName). */
  value: string | null;
  /** Pre-known label for `value`. If null, resolveLabel runs on mount. */
  label?: string | null;
  /**
   * Selected match → parent persists. Match is null when user clears via "×".
   */
  onChange: (match: ProviderUserMatch | null) => void;
  /** Called on the first focus to lazy-load any cache the search() needs. */
  onLoad?: () => Promise<void> | void;
  /** Sync (cache-backed) or async (network-backed) candidate search. */
  search: (query: string, signal?: AbortSignal) => ProviderUserMatch[] | Promise<ProviderUserMatch[]>;
  /** One-shot label resolution for `value` after a cold reload. */
  resolveLabel?: (handle: string) => Promise<string | null>;
  placeholder?: string;
  disabled?: boolean;
  disabledHint?: string;
  /** Used to seed the search input's initial query when first opened. */
  initialSeed?: string;
  /**
   * Optional extra classes. Inherits the standard onboarding input shell
   * via `inputCls`.
   */
  className?: string;
}

const DEBOUNCE_MS = 150;

export function UserCombobox({
  provider,
  value,
  label,
  onChange,
  onLoad,
  search,
  resolveLabel,
  placeholder,
  disabled,
  disabledHint,
  initialSeed,
  className,
}: UserComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProviderUserMatch[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<string | null>(label ?? null);
  const loadedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve label once, on first mount or when the persisted value changes
  // out from under us. Skip when the parent already supplied a label.
  useEffect(() => {
    if (label) {
      setResolved(label);
      return;
    }
    if (!value || !resolveLabel) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await resolveLabel(value);
        if (!cancelled) setResolved(r);
      } catch {
        if (!cancelled) setResolved(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, label, resolveLabel]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Debounced search whenever the user-visible query changes while open.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      runSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  const runSearch = useCallback(
    async (q: string) => {
      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        const r = await search(q, ac.signal);
        if (!ac.signal.aborted) {
          setResults(r);
          setHighlight(0);
        }
      } catch (err: any) {
        if (ac.signal.aborted) return;
        if (err?.name === "AbortError") return;
        setResults([]);
      } finally {
        // Always clear loading. The next runSearch will set it again — this
        // avoids leaving a stale spinner up if the user closes the dropdown
        // while a request is mid-flight.
        setLoading(false);
      }
    },
    [search]
  );

  // Abort any in-flight search when the combobox unmounts (row removed
  // from StepTeam, Settings panel collapsed, etc).
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleFocus = useCallback(async () => {
    if (disabled) return;
    if (!loadedRef.current && onLoad) {
      loadedRef.current = true;
      try {
        await onLoad();
      } catch {
        // The parent can surface load errors; the combobox just renders
        // whatever the search() returns (empty list is fine).
      }
    }
    if (!open) {
      // Seed the query the first time we open if no value is set yet.
      if (!value && !query && initialSeed) setQuery(initialSeed);
      setOpen(true);
      runSearch(value ? "" : query || initialSeed || "");
    }
  }, [disabled, onLoad, open, value, query, initialSeed, runSearch]);

  const choose = useCallback(
    (m: ProviderUserMatch) => {
      onChange(m);
      setResolved(m.label);
      setQuery("");
      setOpen(false);
      // Drop focus so a subsequent focus reopens fresh.
      inputRef.current?.blur();
    },
    [onChange]
  );

  const clear = useCallback(() => {
    onChange(null);
    setResolved(null);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }, [onChange]);

  // Display text — when closed and a value is set, show the resolved label.
  // When the combobox is open the user is searching, so we show their query.
  const displayValue = open
    ? query
    : resolved
      ? resolved
      : value
        ? value
        : "";

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        handleFocus();
        return;
      }
      setHighlight((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (open && results[highlight]) {
        e.preventDefault();
        choose(results[highlight]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Backspace" && !query && resolved) {
      // Edge case: if the input is empty (showing resolved label as
      // placeholder-like text), Backspace shouldn't silently clear the
      // value. User must use the × affordance.
      e.preventDefault();
    }
  };

  const inputClass = useMemo(
    () => `${inputCls} ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className || ""}`,
    [disabled, className]
  );

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-disabled={disabled || undefined}
        aria-label={`Pick ${provider} user`}
        className={inputClass + " pr-7"}
        placeholder={
          disabled ? disabledHint || `${provider} not connected` : placeholder || `Search ${provider}…`
        }
        value={displayValue}
        disabled={disabled}
        readOnly={!open && !!resolved}
        onFocus={handleFocus}
        onChange={(e) => {
          if (disabled) return;
          if (!open) setOpen(true);
          setQuery(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {/* clear / spinner / chevron — single anchor, swap based on state */}
      <span
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-ink-faint"
        aria-hidden
      >
        {loading && open ? (
          <span className="text-[10px] tracking-[0.18em] uppercase breathing">…</span>
        ) : null}
      </span>
      {!disabled && value && !open && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            clear();
          }}
          aria-label="Clear selection"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink text-xs leading-none"
        >
          ×
        </button>
      )}
      {open && !disabled && (
        <div
          role="listbox"
          aria-label={`${provider} user search results`}
          className="absolute left-0 top-full z-30 mt-1 min-w-full w-max max-w-[360px] max-h-[260px] overflow-y-auto rounded-md border border-hairline bg-canvas shadow-soft"
        >
          {results.length === 0 && !loading && (
            <div className="px-3 py-2 text-xs text-ink-faint whitespace-nowrap">
              {query.trim() ? "No matches" : "Type to search"}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.provider}:${r.id}`}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
                i === highlight ? "bg-surface text-ink" : "text-ink-soft hover:bg-surface"
              }`}
            >
              <span className="min-w-0 flex-1 break-words">
                <span className="font-medium">{r.label}</span>
                {r.detail ? (
                  <span className="ml-2 text-ink-faint">{r.detail}</span>
                ) : null}
              </span>
              {r.score !== undefined && (
                <span className="mono shrink-0 text-[10px] text-ink-faint">{r.score}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
