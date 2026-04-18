import { memo } from "react";

interface HeatmapCellProps {
  count: number;
  maxCount: number;
  isEmpty: boolean;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function getOpacity(count: number, maxCount: number): number {
  if (count === 0) return 0;
  if (count >= maxCount && maxCount > 0) return 0.8;
  if (count >= 4) return 0.55;
  if (count >= 2) return 0.35;
  return 0.15;
}

const HeatmapCell = memo(function HeatmapCell({
  count,
  maxCount,
  isEmpty,
  isSelected,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: HeatmapCellProps) {
  const opacity = getOpacity(count, maxCount);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="relative flex items-center justify-center rounded-[4px] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      style={{
        width: 32,
        height: 32,
        transition: "border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease",
        backgroundColor: count > 0 ? `color-mix(in srgb, var(--ink) ${Math.round(opacity * 100)}%, transparent)` : isEmpty ? "var(--ink-ghost)" : "transparent",
        border: isSelected
          ? "2px solid var(--accent)"
          : "1px solid transparent",
        boxShadow: undefined,
      }}
      onMouseOver={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLElement).style.borderColor = "var(--ink-faint)";
        }
      }}
      onMouseOut={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLElement).style.borderColor = "transparent";
        }
      }}
      aria-label={`${count} item${count !== 1 ? "s" : ""}`}
    >
      {/* Empty cell: faint x pattern */}
      {isEmpty && count === 0 && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className="opacity-20"
          aria-hidden="true"
        >
          <line x1="2" y1="2" x2="8" y2="8" stroke="var(--ink-muted)" strokeWidth="1" />
          <line x1="8" y1="2" x2="2" y2="8" stroke="var(--ink-muted)" strokeWidth="1" />
        </svg>
      )}

      {/* Zero-activity but not empty: dot pattern */}
      {!isEmpty && count === 0 && (
        <svg
          width="4"
          height="4"
          viewBox="0 0 4 4"
          className="opacity-25"
          aria-hidden="true"
        >
          <circle cx="2" cy="2" r="1" fill="var(--ink-muted)" />
        </svg>
      )}
    </button>
  );
});

export default HeatmapCell;
