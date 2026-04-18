// Graph node — circle with brand icon, floating label on hover.

import type { EvidenceSource } from "../../lib/types";

export const SOURCE_COLORS: Record<EvidenceSource, string> = {
  github_pr: "#24292f",
  github_review: "#7c3aed",
  slack_message: "#4A154B",
  jira_issue: "#2684ff",
  jira_comment: "#0052cc",
  linear_issue: "#5E6AD2",
  linear_comment: "#5E6AD2",
};

// Lighter fill for the node background
const SOURCE_BG: Record<EvidenceSource, string> = {
  github_pr: "#f6f8fa",
  github_review: "#f5f3ff",
  slack_message: "#fff8f6",
  jira_issue: "#e9f2ff",
  jira_comment: "#e9f2ff",
  linear_issue: "#eef0fb",
  linear_comment: "#eef0fb",
};

interface Props {
  x: number;
  y: number;
  r: number;
  source: EvidenceSource;
  label: string;
  isHovered: boolean;
  isConnected: boolean;
  isPinned: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function GraphNode({
  x,
  y,
  r,
  source,
  label,
  isHovered,
  isConnected,
  isPinned,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  const color = SOURCE_COLORS[source];
  const bg = SOURCE_BG[source];
  const active = isHovered || isPinned;
  const opacity = isConnected ? 1 : 0.25;
  const iconSize = Math.max(10, r * 0.9);

  return (
    <g
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ cursor: "pointer", opacity, transition: "opacity 200ms ease" }}
    >
      {/* Outer ring on active */}
      {active && (
        <circle
          cx={x}
          cy={y}
          r={r + 5}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          opacity={0.3}
        />
      )}

      {/* Node circle — light fill with colored border */}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={bg}
        stroke={color}
        strokeWidth={active ? 2 : 1.5}
        style={{ transition: "stroke-width 200ms ease" }}
      />

      {/* Brand icon centered in node */}
      <foreignObject
        x={x - iconSize / 2}
        y={y - iconSize / 2}
        width={iconSize}
        height={iconSize}
        style={{ pointerEvents: "none" }}
      >
        <div
          // @ts-expect-error xmlns for foreignObject
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            color,
          }}
        >
          {sourceIcon(source, Math.max(8, iconSize * 0.7))}
        </div>
      </foreignObject>

      {/* Label — shown on hover/pin */}
      {active && (
        <>
          {/* Label background */}
          <rect
            x={x - measureLabel(label) / 2 - 6}
            y={y + r + 6}
            width={measureLabel(label) + 12}
            height={18}
            rx={4}
            fill="var(--canvas, #fff)"
            stroke="var(--hairline, #e5e5e5)"
            strokeWidth={0.5}
          />
          <text
            x={x}
            y={y + r + 18}
            textAnchor="middle"
            fill="var(--ink-soft, #3a3a38)"
            fontSize={10}
            fontFamily="Inter, -apple-system, sans-serif"
            fontWeight={500}
          >
            {label.length > 28 ? label.slice(0, 27) + "…" : label}
          </text>
        </>
      )}
    </g>
  );
}

function measureLabel(label: string): number {
  const text = label.length > 28 ? label.slice(0, 27) + "…" : label;
  return text.length * 5.5;
}

/** Inline SVG icons matching the brand icons from SourceBadge. */
function sourceIcon(source: EvidenceSource, size: number): React.ReactNode {
  if (source.startsWith("github")) {
    return (
      <svg width={size} height={size} viewBox="0 -0.5 25 25" fill="currentColor">
        <path d="M12.301 0h.093c2.242 0 4.34.613 6.137 1.68l-.055-.031c1.871 1.094 3.386 2.609 4.449 4.422l.031.058c1.04 1.769 1.654 3.896 1.654 6.166 0 5.406-3.483 10-8.327 11.658l-.087.026c-.063.02-.135.031-.209.031-.162 0-.312-.054-.433-.144l.002.001c-.128-.115-.208-.281-.208-.466v-.014.001q0-.048.008-1.226t.008-2.154c.007-.075.011-.161.011-.249 0-.792-.323-1.508-.844-2.025.618-.061 1.176-.163 1.718-.305l-.076.017c.573-.16 1.073-.373 1.537-.642l-.031.017c.508-.28.938-.636 1.292-1.058l.006-.007c.372-.476.663-1.036.84-1.645l.009-.035c.209-.683.329-1.468.329-2.281 0-.045 0-.091-.001-.136v.007c0-.022.001-.047.001-.072 0-1.248-.482-2.383-1.269-3.23l.003.003c.168-.44.265-.948.265-1.479 0-.649-.145-1.263-.404-1.814l.011.026c-.115-.022-.246-.035-.381-.035-.334 0-.649.078-.929.216l.012-.005c-.568.21-1.054.448-1.512.726l.038-.022-.609.384c-.922-.264-1.981-.416-3.075-.416s-2.153.152-3.157.436l.081-.02q-.256-.176-.681-.433c-.373-.214-.814-.421-1.272-.595l-.066-.022c-.293-.154-.64-.244-1.009-.244-.124 0-.246.01-.364.03l.013-.002c-.248.524-.393 1.139-.393 1.788 0 .531.097 1.04.275 1.509l-.01-.029c-.785.844-1.266 1.979-1.266 3.227v.076-.004c-.001.039-.001.084-.001.13 0 .809.12 1.591.344 2.327l-.015-.057c.189.643.476 1.202.85 1.693l-.009-.013c.354.435.782.793 1.267 1.062l.022.011c.432.252.933.465 1.46.614l.046.011c.466.125 1.024.227 1.595.284l.046.004c-.431.428-.718 1-.784 1.638l-.001.012c-.207.101-.448.183-.699.236l-.021.004c-.256.051-.549.08-.85.08h-.066.003c-.394-.008-.756-.136-1.055-.348l.006.004c-.371-.259-.671-.595-.881-.986l-.007-.015c-.198-.336-.459-.614-.768-.827l-.009-.006c-.225-.169-.49-.301-.776-.38l-.016-.004-.32-.048c-.023-.002-.05-.003-.077-.003-.14 0-.273.028-.394.077l.007-.003q-.128.072-.08.184c.039.086.087.16.145.225l-.001-.001c.061.072.13.135.205.19l.003.002.112.08c.283.148.516.354.693.603l.004.006c.191.237.359.505.494.792l.01.024.16.368c.135.402.38.738.7.981l.005.004c.3.234.662.402 1.057.478l.016.002c.33.064.714.104 1.106.112h.007c.045.002.097.002.15.002.261 0 .517-.021.767-.062l-.027.004.368-.064q0 .609.008 1.418t.008.873v.014c0 .185-.08.351-.208.466h-.001c-.119.089-.268.143-.431.143-.075 0-.147-.011-.214-.032l.005.001c-4.929-1.689-8.409-6.283-8.409-11.69 0-2.268.612-4.393 1.681-6.219l-.032.058c1.094-1.871 2.609-3.386 4.422-4.449l.058-.031c1.739-1.034 3.835-1.645 6.073-1.645h.098-.005z" />
      </svg>
    );
  }
  if (source.startsWith("slack")) {
    return (
      <svg width={size} height={size} viewBox="0 0 127 127" fill="none">
        <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80s5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A"/>
        <path d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0"/>
        <path d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z" fill="#2EB67D"/>
        <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z" fill="#ECB22E"/>
      </svg>
    );
  }
  if (source.startsWith("jira")) {
    return (
      <svg width={size} height={size} viewBox="0 -30.632 255.324 285.956" fill="none">
        <path d="M244.658 0H121.707a55.502 55.502 0 0 0 55.502 55.502h22.649V77.37c.02 30.625 24.841 55.447 55.466 55.467V10.666C255.324 4.777 250.55 0 244.658 0z" fill="#2684ff"/>
        <path d="M183.822 61.262H60.872c.019 30.625 24.84 55.447 55.466 55.467h22.649v21.938c.039 30.625 24.877 55.43 55.502 55.43V71.93c0-5.891-4.776-10.667-10.667-10.667z" fill="#1D7AFC"/>
        <path d="M122.951 122.489H0c0 30.653 24.85 55.502 55.502 55.502h22.72v21.867c.02 30.597 24.798 55.408 55.396 55.466V133.156c0-5.891-4.776-10.667-10.667-10.667z" fill="#0052CC"/>
      </svg>
    );
  }
  if (source.startsWith("linear")) {
    return (
      <svg width={size} height={size} viewBox="0 0 256 256" fill="#5E6AD2">
        <path d="M8.174 102.613L153.387 247.826c2.12 2.12 1.097 5.72-1.849 6.27a128 128 0 0 1-14.92 3.896 2.67 2.67 0 0 1-2.92-1.108L1.117 122.403a2.67 2.67 0 0 1-1.109-2.921 128 128 0 0 1 1.895-15.02c.55-2.946 4.151-3.969 6.27-1.849z"/>
        <path d="M4.082 161.41c-.969-3.614 3.3-5.894 5.946-3.249l87.811 87.811c2.646 2.646.363 6.915-3.251 5.946A128.1 128.1 0 0 1 4.082 161.41z"/>
        <path d="M16.809 64.164c1.233-2.136 4.147-2.463 5.891-.719L192.555 233.3c1.744 1.744 1.417 4.658-.819 5.891a128 128 0 0 1-11.09 5.705 2.67 2.67 0 0 1-4.22-1.789L11.893 79.485a2.67 2.67 0 0 1-1.789-4.22 128 128 0 0 1 6.705-11.101z"/>
        <path d="M127.86 0c70.77 0 128.14 57.37 128.14 128.14 0 37.569-16.168 71.363-41.926 94.801a2.67 2.67 0 0 1-5.19-1.842L33.217 47.116a2.67 2.67 0 0 1-1.842-5.19A127.9 127.9 0 0 1 127.86 0z"/>
      </svg>
    );
  }
  return null;
}

/** Extract a short label from evidence content. */
export function nodeLabel(source: EvidenceSource, content: string): string {
  if (source === "github_pr") {
    const m = content.match(/^PR [\w/.-]+(#\d+):\s*(.+)/);
    if (m) return `${m[1]} ${m[2].slice(0, 30)}`;
  }
  if (source === "github_review") {
    const m = content.match(/^Review on [\w/.-]+(#\d+)/);
    if (m) return `Review ${m[1]}`;
  }
  if (source === "slack_message") {
    const m = content.match(/^(#[\w-]+)/);
    if (m) return m[1];
  }
  if (source === "jira_issue") {
    const m = content.match(/^([\w]+-\d+)/);
    if (m) return m[1];
  }
  if (source === "jira_comment") {
    const m = content.match(/^Comment on ([\w]+-\d+)/);
    if (m) return m[1];
  }
  if (source === "linear_issue") {
    const m = content.match(/^([\w]+-\d+)/);
    if (m) return m[1];
  }
  if (source === "linear_comment") {
    const m = content.match(/^Comment on ([\w]+-\d+)/);
    if (m) return m[1];
  }
  return content.split("\n")[0].slice(0, 20);
}
