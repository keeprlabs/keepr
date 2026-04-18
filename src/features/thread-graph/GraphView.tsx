// Evidence graph — interactive force-directed visualization.
// Supports: zoom (scroll/buttons), pan (drag background), drag nodes,
// hover/pin for detail cards.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceItem, EvidenceSource, TeamMember } from "../../lib/types";
import { EvidenceCard } from "../evidence-cards/EvidenceCard";
import { GraphNode, SOURCE_COLORS, nodeLabel } from "./GraphNode";
import { inferEdges, type GraphEdge } from "./inferEdges";
import { layoutGraph, type GraphNodePosition } from "./layoutGraph";

const ALL_SOURCES: EvidenceSource[] = [
  "github_pr", "github_review", "slack_message",
  "jira_issue", "jira_comment", "linear_issue", "linear_comment",
];

interface Props {
  evidence: EvidenceItem[];
  members: TeamMember[];
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const curvature = Math.min(dist * 0.15, 50);
  const nx = -dy / dist;
  const ny = dx / dist;
  const mx = (x1 + x2) / 2 + nx * curvature;
  const my = (y1 + y2) / 2 + ny * curvature;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

export function GraphView({ evidence, members }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Filters ────────────────────────────────────────────────────────
  const [selectedMemberId, setSelectedMemberId] = useState<number | "all">("all");
  const [enabledSources, setEnabledSources] = useState<Set<EvidenceSource>>(
    () => new Set(ALL_SOURCES),
  );
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const toggleSource = (s: EvidenceSource) => {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const filtered = useMemo(() => {
    return evidence.filter((e) => {
      if (selectedMemberId !== "all" && e.actor_member_id !== selectedMemberId) return false;
      if (!enabledSources.has(e.source)) return false;
      if (dateFrom && e.timestamp_at < dateFrom) return false;
      if (dateTo && e.timestamp_at > dateTo) return false;
      return true;
    });
  }, [evidence, selectedMemberId, enabledSources, dateFrom, dateTo]);

  // ── Graph data ─────────────────────────────────────────────────────
  const edges = useMemo(() => inferEdges(filtered), [filtered]);
  const initialNodes = useMemo(
    () => layoutGraph(filtered, members, size.width, size.height, edges),
    [filtered, members, size.width, size.height, edges],
  );

  // Mutable node positions for dragging
  const [nodes, setNodes] = useState<GraphNodePosition[]>(initialNodes);
  useEffect(() => setNodes(initialNodes), [initialNodes]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const evidenceMap = useMemo(() => new Map(filtered.map((e) => [e.id, e])), [filtered]);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  // ── Zoom & Pan ─────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Reset zoom/pan when data changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [filtered.length]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.2, Math.min(5, z * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only pan on background click (not on nodes)
    if ((e.target as SVGElement).closest("g[data-node]")) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingNode.current != null) {
      // Dragging a node
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const svgX = (e.clientX - rect.left - pan.x) / zoom;
      const svgY = (e.clientY - rect.top - pan.y) / zoom;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === draggingNode.current ? { ...n, x: svgX, y: svgY } : n
        )
      );
      return;
    }
    if (!isPanning.current) return;
    setPan({
      x: panStart.current.panX + (e.clientX - panStart.current.x),
      y: panStart.current.panY + (e.clientY - panStart.current.y),
    });
  }, [pan, zoom]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    draggingNode.current = null;
  }, []);

  // ── Node dragging ──────────────────────────────────────────────────
  const draggingNode = useRef<number | null>(null);

  const handleNodeDragStart = useCallback((id: number) => {
    draggingNode.current = id;
  }, []);

  // ── Zoom controls ──────────────────────────────────────────────────
  const zoomIn = () => setZoom((z) => Math.min(5, z * 1.3));
  const zoomOut = () => setZoom((z) => Math.max(0.2, z / 1.3));
  const fitToScreen = () => {
    if (nodes.length === 0) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 60;
    const maxX = Math.max(...xs) + 60;
    const minY = Math.min(...ys) - 60;
    const maxY = Math.max(...ys) + 60;
    const graphW = maxX - minX;
    const graphH = maxY - minY;
    const scale = Math.min(size.width / graphW, size.height / graphH, 2) * 0.85;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setZoom(scale);
    setPan({
      x: size.width / 2 - centerX * scale,
      y: size.height / 2 - centerY * scale,
    });
  };

  // ── Interaction ────────────────────────────────────────────────────
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [pinnedId, setPinnedId] = useState<number | null>(null);

  const activeId = pinnedId ?? hoveredId;

  const connectedIds = useMemo(() => {
    if (activeId == null) return new Set<number>();
    const ids = new Set<number>();
    ids.add(activeId);
    for (const e of edges) {
      if (e.fromId === activeId) ids.add(e.toId);
      if (e.toId === activeId) ids.add(e.fromId);
    }
    return ids;
  }, [activeId, edges]);

  const isConnected = useCallback(
    (id: number) => (activeId == null ? true : connectedIds.has(id)),
    [activeId, connectedIds],
  );

  const handleNodeClick = (id: number) => {
    if (draggingNode.current != null) return;
    setPinnedId((prev) => (prev === id ? null : id));
  };

  const cardNode = activeId != null ? nodeMap.get(activeId) : null;
  const cardEvidence = activeId != null ? evidenceMap.get(activeId) : null;

  if (filtered.length < 3) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-muted">
        Not enough evidence to show relationships. Run a session first.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-2.5">
        <select
          value={selectedMemberId}
          onChange={(e) =>
            setSelectedMemberId(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          className="rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-xs text-ink-soft"
        >
          <option value="all">All members</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1.5">
          {ALL_SOURCES.map((s) => {
            const on = enabledSources.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSource(s)}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors duration-150"
                style={{
                  backgroundColor: on ? `${SOURCE_COLORS[s]}14` : "transparent",
                  color: on ? SOURCE_COLORS[s] : "var(--ink-ghost)",
                  border: `1px solid ${on ? `${SOURCE_COLORS[s]}30` : "var(--hairline)"}`,
                }}
              >
                {sourceLabel(s)}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1.5 text-[10px] text-ink-muted">
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded border border-hairline bg-canvas px-1.5 py-1 text-[10px] text-ink-soft"
          />
          <span>to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded border border-hairline bg-canvas px-1.5 py-1 text-[10px] text-ink-soft"
          />
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isPanning.current ? "grabbing" : "grab" }}
      >
        <svg
          ref={svgRef}
          width={size.width}
          height={size.height}
          className="block"
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Edges */}
            {edges.map((edge) => {
              const from = nodeMap.get(edge.fromId);
              const to = nodeMap.get(edge.toId);
              if (!from || !to) return null;

              const highlighted =
                activeId != null && (edge.fromId === activeId || edge.toId === activeId);
              const dimmed = activeId != null && !highlighted;

              return (
                <path
                  key={`${edge.fromId}-${edge.toId}-${edge.relationship}`}
                  d={bezierPath(from.x, from.y, to.x, to.y)}
                  fill="none"
                  stroke={highlighted ? SOURCE_COLORS[from.source] : "var(--ink-ghost, #d4d4d4)"}
                  strokeWidth={highlighted ? 1.5 : 0.75}
                  opacity={dimmed ? 0.08 : highlighted ? 0.7 : 0.4}
                  strokeDasharray={edge.relationship === "references" ? "4 3" : undefined}
                  style={{ transition: "opacity 250ms ease, stroke 250ms ease" }}
                />
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => {
              const ev = evidenceMap.get(node.id);
              if (!ev) return null;
              return (
                <g
                  key={node.id}
                  data-node={node.id}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleNodeDragStart(node.id);
                  }}
                >
                  <GraphNode
                    x={node.x}
                    y={node.y}
                    r={node.r}
                    source={node.source}
                    label={nodeLabel(node.source, ev.content)}
                    isHovered={hoveredId === node.id}
                    isConnected={isConnected(node.id)}
                    isPinned={pinnedId === node.id}
                    onClick={() => handleNodeClick(node.id)}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  />
                </g>
              );
            })}
          </g>
        </svg>

        {/* Zoom controls */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1">
          <button
            onClick={zoomIn}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline bg-canvas text-ink-soft shadow-sm transition-colors hover:text-ink"
            title="Zoom in"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={zoomOut}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline bg-canvas text-ink-soft shadow-sm transition-colors hover:text-ink"
            title="Zoom out"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={fitToScreen}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline bg-canvas text-ink-soft shadow-sm transition-colors hover:text-ink"
            title="Fit to screen"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 6V3a1 1 0 0 1 1-1h3M10 2h3a1 1 0 0 1 1 1v3M14 10v3a1 1 0 0 1-1 1h-3M6 14H3a1 1 0 0 1-1-1v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Zoom indicator */}
        <div className="absolute bottom-4 left-4 text-[10px] tabular-nums text-ink-faint">
          {Math.round(zoom * 100)}%
        </div>

        {/* Detail card on pin */}
        {pinnedId != null && cardNode && cardEvidence && (
          <div
            className="pointer-events-auto absolute z-10"
            style={{
              left: Math.min(cardNode.x * zoom + pan.x + cardNode.r + 16, size.width - 380),
              top: Math.max(cardNode.y * zoom + pan.y - 40, 8),
            }}
          >
            <EvidenceCard evidence={cardEvidence} members={members} />
          </div>
        )}
      </div>
    </div>
  );
}

function sourceLabel(source: EvidenceSource): string {
  switch (source) {
    case "github_pr": return "PR";
    case "github_review": return "Review";
    case "slack_message": return "Slack";
    case "jira_issue": return "Jira";
    case "jira_comment": return "Jira comment";
    case "linear_issue": return "Linear";
    case "linear_comment": return "Linear comment";
  }
}
