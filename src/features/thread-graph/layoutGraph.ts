// Force-directed layout — organic positioning with strong repulsion
// to keep nodes well-separated and readable.

import type { EvidenceItem, EvidenceSource, TeamMember } from "../../lib/types";
import type { GraphEdge } from "./inferEdges";

export interface GraphNodePosition {
  id: number;
  x: number;
  y: number;
  r: number;
  source: EvidenceSource;
  memberId: number | null;
}

/**
 * Compute node radius based on connection count.
 */
function computeRadius(id: number, edges: GraphEdge[]): number {
  let count = 0;
  for (const e of edges) {
    if (e.fromId === id || e.toId === id) count++;
  }
  return Math.min(24, 10 + count * 4);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function layoutGraph(
  evidence: EvidenceItem[],
  _members: TeamMember[],
  width: number,
  height: number,
  edges: GraphEdge[] = [],
): GraphNodePosition[] {
  if (evidence.length === 0) return [];

  const cx = width / 2;
  const cy = height / 2;

  // Initial positions — spread in a large circle
  const spreadRadius = Math.min(width, height) * 0.35;
  const positions: GraphNodePosition[] = evidence.map((e, i) => {
    const angle = (i / evidence.length) * Math.PI * 2;
    const jitter = seededRandom(e.id) * 0.6;
    const dist = spreadRadius * (0.4 + jitter);

    return {
      id: e.id,
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
      r: computeRadius(e.id, edges),
      source: e.source,
      memberId: e.actor_member_id,
    };
  });

  const n = positions.length;
  if (n <= 1) return positions;

  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  // Build edge index for fast lookup
  const edgeIndices: Array<[number, number]> = [];
  for (const edge of edges) {
    const ai = positions.findIndex((p) => p.id === edge.fromId);
    const bi = positions.findIndex((p) => p.id === edge.toId);
    if (ai >= 0 && bi >= 0) edgeIndices.push([ai, bi]);
  }

  for (let iter = 0; iter < 120; iter++) {
    const t = 1 - iter / 120;
    const cooling = t * t; // Quadratic cooling

    vx.fill(0);
    vy.fill(0);

    // Repulsion — all pairs, strong force
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = positions[i];
        const b = positions[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const minDist = a.r + b.r + 60;

        // Repel strongly within 4x minDist
        const force = (2500 * cooling) / (dist * dist + 100);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        vx[i] += dx;
        vy[i] += dy;
        vx[j] -= dx;
        vy[j] -= dy;

        // Hard collision push
        if (dist < minDist) {
          const push = (minDist - dist) * 0.5;
          const px = (dx / (Math.abs(dx) + Math.abs(dy) || 1)) * push;
          const py = (dy / (Math.abs(dx) + Math.abs(dy) || 1)) * push;
          vx[i] += px;
          vy[i] += py;
          vx[j] -= px;
          vy[j] -= py;
        }
      }
    }

    // Attraction along edges — gentle spring
    for (const [ai, bi] of edgeIndices) {
      const a = positions[ai];
      const b = positions[bi];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const idealDist = a.r + b.r + 120;

      const force = (dist - idealDist) * 0.04 * cooling;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      vx[ai] += fx;
      vy[ai] += fy;
      vx[bi] -= fx;
      vy[bi] -= fy;
    }

    // Very gentle gravity — just prevent drift
    for (let i = 0; i < n; i++) {
      vx[i] += (cx - positions[i].x) * 0.005 * cooling;
      vy[i] += (cy - positions[i].y) * 0.005 * cooling;
    }

    // Apply with velocity limit
    for (let i = 0; i < n; i++) {
      const speed = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      const maxSpeed = 15 * cooling + 2;
      if (speed > maxSpeed) {
        vx[i] = (vx[i] / speed) * maxSpeed;
        vy[i] = (vy[i] / speed) * maxSpeed;
      }
      positions[i].x += vx[i];
      positions[i].y += vy[i];
    }
  }

  return positions;
}
