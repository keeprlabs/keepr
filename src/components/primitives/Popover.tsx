// Generic popover — position: fixed + getBoundingClientRect, portaled to body.
// No @floating-ui dependency. Focus trap, Escape closes, configurable hover delay.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Placement = "top" | "bottom" | "left" | "right";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  placement?: Placement;
  children: React.ReactNode;
  className?: string;
}

export function Popover({
  open,
  onClose,
  anchorRect,
  placement = "bottom",
  children,
  className = "",
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    opacity: 0,
    pointerEvents: "none",
  });

  // Position the popover relative to the anchor rect.
  useEffect(() => {
    if (!open || !anchorRect) {
      setStyle((s) => ({ ...s, opacity: 0, pointerEvents: "none" }));
      return;
    }

    const gap = 8;
    const el = ref.current;
    const elW = el?.offsetWidth || 360;
    const elH = el?.offsetHeight || 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;

    if (placement === "bottom") {
      top = anchorRect.bottom + gap;
      left = anchorRect.left + anchorRect.width / 2 - elW / 2;
    } else if (placement === "top") {
      top = anchorRect.top - elH - gap;
      left = anchorRect.left + anchorRect.width / 2 - elW / 2;
    } else if (placement === "right") {
      top = anchorRect.top + anchorRect.height / 2 - elH / 2;
      left = anchorRect.right + gap;
    } else {
      top = anchorRect.top + anchorRect.height / 2 - elH / 2;
      left = anchorRect.left - elW - gap;
    }

    // Clamp within viewport.
    left = Math.max(8, Math.min(left, vw - elW - 8));
    top = Math.max(8, Math.min(top, vh - elH - 8));

    setStyle({
      position: "fixed",
      top,
      left,
      opacity: 1,
      pointerEvents: "auto",
      zIndex: 9999,
    });
  }, [open, anchorRect, placement]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing on the same click that opens.
    const id = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, onClose]);

  // Focus trap: Tab wraps within popover.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Tab" || !ref.current) return;
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    []
  );

  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      className={className}
      style={{
        ...style,
        transition: prefersReducedMotion
          ? "none"
          : "opacity 150ms cubic-bezier(0.22, 0.61, 0.36, 1)",
      }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    document.body
  );
}

/** Hook for hover-with-grace-period popover behavior. */
export function usePopoverHover(delay = 200, grace = 150) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [pinned, setPinned] = useState(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onAnchorEnter = useCallback(
    (rect: DOMRect) => {
      clearTimeout(leaveTimer.current);
      enterTimer.current = setTimeout(() => {
        setAnchorRect(rect);
        setOpen(true);
      }, delay);
    },
    [delay]
  );

  const onAnchorLeave = useCallback(() => {
    clearTimeout(enterTimer.current);
    if (pinned) return;
    leaveTimer.current = setTimeout(() => {
      setOpen(false);
    }, grace);
  }, [grace, pinned]);

  const onPopoverEnter = useCallback(() => {
    clearTimeout(leaveTimer.current);
  }, []);

  const onPopoverLeave = useCallback(() => {
    if (pinned) return;
    leaveTimer.current = setTimeout(() => {
      setOpen(false);
    }, grace);
  }, [grace, pinned]);

  const pin = useCallback(() => setPinned(true), []);

  const close = useCallback(() => {
    clearTimeout(enterTimer.current);
    clearTimeout(leaveTimer.current);
    setPinned(false);
    setOpen(false);
  }, []);

  return {
    open,
    anchorRect,
    pinned,
    onAnchorEnter,
    onAnchorLeave,
    onPopoverEnter,
    onPopoverLeave,
    pin,
    close,
  };
}
