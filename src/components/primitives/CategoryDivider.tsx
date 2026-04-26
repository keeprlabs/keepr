// Section divider for grouped pickers (LLM provider grid, Settings switcher).
// Reuses the eyebrow vocabulary already established at Settings.tsx:170 —
// a thin hairline rule with a small-caps tracked label inline-centered.
//
// A11y: the visible label IS the announcement. The wrapper is role="presentation"
// so screen readers read the label text directly, not "<label>, separator" twice.
// The two flanking rules are decorative.

export function CategoryDivider({ label }: { label: string }) {
  return (
    <div
      role="presentation"
      className="my-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-ink-faint"
    >
      <span className="h-px flex-1 bg-hairline" aria-hidden />
      <span>{label}</span>
      <span className="h-px flex-1 bg-hairline" aria-hidden />
    </div>
  );
}
