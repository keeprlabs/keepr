// Single citation popover — repositions on hover over .cite elements.
// Event delegation on the reading ref. Click pins, Escape closes.

import { useCallback, useEffect, useRef } from "react";
import type { EvidenceItem, TeamMember } from "../../lib/types";
import { Popover, usePopoverHover } from "../../components/primitives/Popover";
import { EvidenceCard } from "./EvidenceCard";

interface Props {
  readingRef: React.RefObject<HTMLDivElement | null>;
  evById: Map<string, EvidenceItem>;
  members: TeamMember[];
  enabled: boolean;
  onGoToEvidence?: (id: string) => void;
}

export function CitationPopover({
  readingRef,
  evById,
  members,
  enabled,
  onGoToEvidence,
}: Props) {
  const {
    open,
    anchorRect,
    onAnchorEnter,
    onAnchorLeave,
    onPopoverEnter,
    onPopoverLeave,
    pin,
    close,
  } = usePopoverHover(200, 150);
  const activeEvId = useRef<string | null>(null);

  // Event delegation: mouseenter/mouseleave on .cite elements.
  useEffect(() => {
    if (!enabled) return;
    const el = readingRef.current;
    if (!el) return;

    const handleEnter = (e: MouseEvent) => {
      const cite = (e.target as HTMLElement).closest(".cite");
      if (!cite) return;
      const id = cite.getAttribute("data-ev");
      if (!id || !evById.has(id)) return;
      activeEvId.current = id;
      const rect = cite.getBoundingClientRect();
      onAnchorEnter(rect);
    };

    const handleLeave = (e: MouseEvent) => {
      const cite = (e.target as HTMLElement).closest(".cite");
      if (!cite) return;
      onAnchorLeave();
    };

    const handleClick = (e: MouseEvent) => {
      const cite = (e.target as HTMLElement).closest(".cite");
      if (!cite) return;
      const id = cite.getAttribute("data-ev");
      if (!id || !evById.has(id)) return;
      activeEvId.current = id;
      const rect = cite.getBoundingClientRect();
      onAnchorEnter(rect);
      pin();
    };

    // Keyboard support: Enter/Space on focused citation.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const cite = (e.target as HTMLElement).closest(".cite");
      if (!cite) return;
      e.preventDefault();
      const id = cite.getAttribute("data-ev");
      if (!id || !evById.has(id)) return;
      activeEvId.current = id;
      const rect = cite.getBoundingClientRect();
      onAnchorEnter(rect);
      pin();
    };

    el.addEventListener("mouseenter", handleEnter, true);
    el.addEventListener("mouseleave", handleLeave, true);
    el.addEventListener("click", handleClick);
    el.addEventListener("keydown", handleKeyDown);

    return () => {
      el.removeEventListener("mouseenter", handleEnter, true);
      el.removeEventListener("mouseleave", handleLeave, true);
      el.removeEventListener("click", handleClick);
      el.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, readingRef, evById, onAnchorEnter, onAnchorLeave, pin]);

  const activeEvidence = activeEvId.current
    ? evById.get(activeEvId.current)
    : null;

  const handleGoToEvidence = useCallback(() => {
    if (activeEvId.current && onGoToEvidence) {
      onGoToEvidence(activeEvId.current);
      close();
    }
  }, [onGoToEvidence, close]);

  if (!enabled || !activeEvidence) return null;

  return (
    <Popover
      open={open}
      onClose={close}
      anchorRect={anchorRect}
      placement="bottom"
      className="evidence-popover"
    >
      <div
        onMouseEnter={onPopoverEnter}
        onMouseLeave={onPopoverLeave}
        className="rounded-lg bg-canvas shadow-lg"
        style={{
          boxShadow:
            "0 1px 2px rgba(10,10,10,0.04), 0 12px 32px -4px rgba(10,10,10,0.14)",
          backgroundColor: "#fff",
        }}
      >
        <EvidenceCard
          evidence={activeEvidence}
          members={members}
        />
        {onGoToEvidence && (
          <button
            onClick={handleGoToEvidence}
            className="w-full border-t border-hairline px-4 py-2 text-left text-[10px] text-ink-faint transition-colors duration-180 hover:text-ink"
          >
            Go to evidence panel →
          </button>
        )}
      </div>
    </Popover>
  );
}
