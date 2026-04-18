// Bidirectional claim <-> evidence highlighting.
// Attaches event listeners to reading and evidence refs.

import { useEffect } from "react";

export function useClaimHighlight(
  readingRef: React.RefObject<HTMLDivElement | null>,
  evidenceRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) return;
    const reading = readingRef.current;
    const evidence = evidenceRef.current;
    if (!reading || !evidence) return;

    // Highlight evidence cards when hovering citations in reading pane
    const onCiteEnter = (e: Event) => {
      const cite = (e.target as HTMLElement).closest(".cite");
      if (!cite) return;
      const evId = cite.getAttribute("data-ev");
      if (!evId) return;
      // Highlight all matching cites
      reading.querySelectorAll(`[data-ev="${evId}"]`).forEach(el =>
        el.classList.add("cite-highlighted")
      );
      // Highlight matching evidence card
      evidence.querySelectorAll(`[data-ev-target="${evId}"]`).forEach(el =>
        el.classList.add("ev-highlighted")
      );
    };

    const onCiteLeave = (e: Event) => {
      const cite = (e.target as HTMLElement).closest(".cite");
      if (!cite) return;
      const evId = cite.getAttribute("data-ev");
      if (!evId) return;
      reading.querySelectorAll(`[data-ev="${evId}"]`).forEach(el =>
        el.classList.remove("cite-highlighted")
      );
      evidence.querySelectorAll(`[data-ev-target="${evId}"]`).forEach(el =>
        el.classList.remove("ev-highlighted")
      );
    };

    // Highlight citations when hovering evidence cards
    const onEvEnter = (e: Event) => {
      const card = (e.target as HTMLElement).closest("[data-ev-target]");
      if (!card) return;
      const evId = card.getAttribute("data-ev-target");
      if (!evId) return;
      card.classList.add("ev-highlighted");
      reading.querySelectorAll(`[data-ev="${evId}"]`).forEach(el =>
        el.classList.add("cite-highlighted")
      );
    };

    const onEvLeave = (e: Event) => {
      const card = (e.target as HTMLElement).closest("[data-ev-target]");
      if (!card) return;
      const evId = card.getAttribute("data-ev-target");
      if (!evId) return;
      card.classList.remove("ev-highlighted");
      reading.querySelectorAll(`[data-ev="${evId}"]`).forEach(el =>
        el.classList.remove("cite-highlighted")
      );
    };

    // Attach to reading pane (citations)
    reading.addEventListener("mouseenter", onCiteEnter, true);
    reading.addEventListener("mouseleave", onCiteLeave, true);
    reading.addEventListener("focusin", onCiteEnter, true);
    reading.addEventListener("focusout", onCiteLeave, true);

    // Attach to evidence pane (cards)
    evidence.addEventListener("mouseenter", onEvEnter, true);
    evidence.addEventListener("mouseleave", onEvLeave, true);
    evidence.addEventListener("focusin", onEvEnter, true);
    evidence.addEventListener("focusout", onEvLeave, true);

    return () => {
      reading.removeEventListener("mouseenter", onCiteEnter, true);
      reading.removeEventListener("mouseleave", onCiteLeave, true);
      reading.removeEventListener("focusin", onCiteEnter, true);
      reading.removeEventListener("focusout", onCiteLeave, true);
      evidence.removeEventListener("mouseenter", onEvEnter, true);
      evidence.removeEventListener("mouseleave", onEvLeave, true);
      evidence.removeEventListener("focusin", onEvEnter, true);
      evidence.removeEventListener("focusout", onEvLeave, true);
    };
  }, [readingRef, evidenceRef, enabled]);
}
