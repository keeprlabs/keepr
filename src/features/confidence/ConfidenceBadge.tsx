// Confidence badge — small dot inline next to section headings.
// Hover shows a popover with citation count and source diversity.

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover, usePopoverHover } from "../../components/primitives/Popover";
import type { SectionConfidence } from "./computeConfidence";

interface Props {
  confidence: SectionConfidence;
}

const COLORS: Record<SectionConfidence["level"], string> = {
  high: "#2d7d46",
  medium: "#b45309",
  low: "#dc2626",
};

export function ConfidenceBadge({ confidence }: Props) {
  const dotRef = useRef<HTMLSpanElement>(null);
  const {
    open,
    anchorRect,
    onAnchorEnter,
    onAnchorLeave,
    onPopoverEnter,
    onPopoverLeave,
    close,
  } = usePopoverHover(300, 150);

  const handleEnter = useCallback(() => {
    if (dotRef.current) {
      onAnchorEnter(dotRef.current.getBoundingClientRect());
    }
  }, [onAnchorEnter]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (dotRef.current) {
          onAnchorEnter(dotRef.current.getBoundingClientRect());
        }
      }
    },
    [onAnchorEnter]
  );

  return (
    <>
      <span
        ref={dotRef}
        role="img"
        aria-label={`${confidence.level} confidence: ${confidence.citationCount} citations from ${confidence.uniqueSources} sources`}
        tabIndex={0}
        onMouseEnter={handleEnter}
        onMouseLeave={onAnchorLeave}
        onKeyDown={handleKeyDown}
        onFocus={handleEnter}
        onBlur={onAnchorLeave}
        className="inline-flex items-center justify-center"
        style={{
          width: 8,
          height: 8,
          marginLeft: 6,
          cursor: "help",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: COLORS[confidence.level],
            display: "block",
          }}
        />
        {confidence.level === "low" && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden
            style={{ marginLeft: 2 }}
          >
            <path
              d="M5 1.5v4M5 7.5v.5"
              stroke="var(--ink-faint)"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <Popover
        open={open}
        onClose={close}
        anchorRect={anchorRect}
        placement="bottom"
      >
        <div
          onMouseEnter={onPopoverEnter}
          onMouseLeave={onPopoverLeave}
          className="rounded-md border border-hairline bg-canvas px-3 py-2 shadow-md"
          style={{ maxWidth: 240 }}
        >
          <div className="text-[11px] text-ink-soft">
            {confidence.citationCount} citation{confidence.citationCount !== 1 ? "s" : ""} from{" "}
            {confidence.uniqueSources} source type{confidence.uniqueSources !== 1 ? "s" : ""}
          </div>
        </div>
      </Popover>
    </>
  );
}

/** Low-confidence banner inserted below h2 headings. */
export function LowConfidenceBanner() {
  return (
    <div className="mb-3 rounded-md bg-[rgba(10,10,10,0.025)] px-3 py-1.5 text-[11px] text-ink-faint">
      Limited evidence found for this section. Review before acting on it.
    </div>
  );
}

/** Mounts confidence badges into h2 headings via React portals. */
export function ConfidencePortals({
  confidences,
  containerRef,
}: {
  confidences: SectionConfidence[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [mounts, setMounts] = useState<
    Array<{ el: HTMLElement; confidence: SectionConfidence; bannerEl: HTMLElement | null }>
  >([]);

  // Find h2 elements and create mount points.
  // Called via useEffect in the parent after render.
  const sync = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const headings = container.querySelectorAll("h2");
    const result: typeof mounts = [];

    headings.forEach((h2) => {
      // Extract heading text — strip any icon spans.
      const labelEl = h2.querySelector(".sec-label");
      const headingText = (labelEl?.textContent || h2.textContent || "").trim();

      // Match against confidence data.
      const conf = confidences.find((c) => {
        // Strip emoji/icon prefixes from section titles for matching.
        const cleanTitle = c.sectionTitle.replace(/^[^\w]*/, "").trim();
        return headingText.toLowerCase().includes(cleanTitle.toLowerCase()) ||
          cleanTitle.toLowerCase().includes(headingText.toLowerCase());
      });

      if (!conf) return;

      // Create or find the confidence mount span.
      let mountEl = h2.querySelector("[data-confidence-mount]") as HTMLElement | null;
      if (!mountEl) {
        mountEl = document.createElement("span");
        mountEl.setAttribute("data-confidence-mount", "true");
        mountEl.style.display = "inline-flex";
        mountEl.style.alignItems = "center";
        h2.appendChild(mountEl);
      }

      // Create or find the low-confidence banner.
      let bannerEl: HTMLElement | null = null;
      if (conf.level === "low") {
        bannerEl = h2.nextElementSibling?.hasAttribute("data-confidence-banner")
          ? (h2.nextElementSibling as HTMLElement)
          : null;
        if (!bannerEl) {
          bannerEl = document.createElement("div");
          bannerEl.setAttribute("data-confidence-banner", "true");
          h2.parentElement?.insertBefore(bannerEl, h2.nextSibling);
        }
      } else {
        // Remove stale banner if level is no longer low.
        const existingBanner = h2.nextElementSibling?.hasAttribute("data-confidence-banner")
          ? h2.nextElementSibling
          : null;
        existingBanner?.remove();
      }

      result.push({ el: mountEl, confidence: conf, bannerEl });
    });

    setMounts(result);
  }, [confidences, containerRef]);

  return { sync, portals: mounts.map(({ el, confidence, bannerEl }) => (
    <>
      {createPortal(<ConfidenceBadge confidence={confidence} />, el)}
      {bannerEl && confidence.level === "low" && createPortal(<LowConfidenceBanner />, bannerEl)}
    </>
  ))};
}
