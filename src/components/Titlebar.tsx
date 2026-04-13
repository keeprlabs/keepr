// A whisper of a title bar — drag handle + wordmark + command hint.
// No window controls drawn by us; macOS draws its own traffic lights.
import wordmarkSvg from "../assets/wordmark.svg";

export function Titlebar({
  onOpenPalette,
  sidebarOpen,
  onToggleSidebar,
}: {
  onOpenPalette: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <div className="drag-region hair-b flex h-11 items-center justify-between bg-canvas pl-20 pr-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="no-drag group flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors duration-180 hover:bg-[rgba(10,10,10,0.045)] hover:text-ink"
          title={sidebarOpen ? "Hide sidebar (⌘\\)" : "Show sidebar (⌘\\)"}
          aria-label="Toggle sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect
              x="2"
              y="3"
              width="12"
              height="10"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <line
              x1="6.5"
              y1="3.5"
              x2="6.5"
              y2="12.5"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            {sidebarOpen && (
              <rect x="3" y="4" width="3" height="8" fill="currentColor" fillOpacity="0.2" />
            )}
          </svg>
        </button>
        <div className="flex items-center gap-2 text-ink-muted">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink" />
          <img src={wordmarkSvg} alt="Keepr" className="h-[13px] opacity-60" />
        </div>
      </div>
      <button
        onClick={onOpenPalette}
        className="no-drag group flex items-center gap-2.5 rounded-full border border-hairline bg-canvas py-[5px] pl-3 pr-1.5 text-[11px] text-ink-muted transition-all duration-180 ease-calm hover:border-ink/25 hover:text-ink"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className="text-ink-faint transition-colors duration-180 group-hover:text-ink-muted"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M11 11l3 3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <span>Search or run a command</span>
        <span className="mono inline-flex items-center rounded-[4px] border border-hairline px-1.5 py-[1px] text-[9.5px] text-ink-faint">
          ⌘K
        </span>
      </button>
      <div className="w-16" />
    </div>
  );
}
