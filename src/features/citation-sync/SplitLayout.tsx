// Evidence slide-out overlay — the reading column stays centered at 680px,
// and the evidence panel slides over from the right edge like Notion's side-peek.
// Below 960px falls back to the original bottom panel.

import { useEffect, useState } from "react";

const PANEL_WIDTH = 380;
const COLLAPSE_THRESHOLD = 960;

interface Props {
  enabled: boolean;
  evidenceOpen: boolean;
  onToggleEvidence: () => void;
  reading: React.ReactNode;
  evidence: React.ReactNode;
  statusBar: React.ReactNode;
}

export function SplitLayout({
  enabled,
  evidenceOpen,
  onToggleEvidence,
  reading,
  evidence,
  statusBar,
}: Props) {
  const [isWide, setIsWide] = useState(
    () => window.innerWidth >= COLLAPSE_THRESHOLD
  );

  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= COLLAPSE_THRESHOLD);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const overlayActive = enabled && isWide;

  // Keyboard: Alt+1 focuses reading, Alt+2 focuses evidence.
  useEffect(() => {
    if (!overlayActive) return;
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === "1") {
        document.querySelector<HTMLElement>(".slide-reading")?.focus();
      } else if (e.key === "2") {
        if (!evidenceOpen) onToggleEvidence();
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(".slide-evidence")?.focus();
        });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [overlayActive, evidenceOpen, onToggleEvidence]);

  if (!overlayActive) {
    // Fallback: existing top/bottom stacked layout.
    return (
      <div className="flex h-full flex-col">
        {reading}
        {evidence}
        {statusBar}
      </div>
    );
  }

  // Side-by-side mode: reading shrinks when evidence is open, evidence slides in.
  return (
    <div className="relative flex h-full flex-col">
      {/* Reading — shrinks to make room for evidence panel */}
      <div
        className="slide-reading flex-1 overflow-y-auto"
        tabIndex={-1}
        style={{
          marginRight: evidenceOpen ? PANEL_WIDTH : 0,
          transition: "margin-right 220ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        }}
      >
        {reading}
      </div>

      {statusBar}

      {/* Evidence panel */}
      <div
        className="slide-evidence absolute top-0 right-0 bottom-0 overflow-y-auto bg-canvas"
        tabIndex={-1}
        style={{
          width: PANEL_WIDTH,
          borderLeft: "1px solid var(--hairline)",
          boxShadow: evidenceOpen
            ? "-4px 0 24px -4px rgba(10,10,10,0.08)"
            : "none",
          transform: evidenceOpen
            ? "translateX(0)"
            : `translateX(${PANEL_WIDTH}px)`,
          transition:
            "transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1), box-shadow 220ms ease-out",
          zIndex: 40,
        }}
      >
        {evidence}
      </div>
    </div>
  );
}
