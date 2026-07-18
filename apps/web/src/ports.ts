/**
 * Connection ports and routing rules.
 *
 * Every box exposes 16 ports — five along the top (t0–t4), five along the
 * bottom (b0–b4) and three on each side (l0–l2, r0–r2). Lines connect only
 * at ports. A relationship with no pinned ports is auto-routed: when two
 * boxes sit in line on the grid the facing mid-ports are chosen, so the line
 * is exactly horizontal or vertical.
 */

import { Position } from "@xyflow/react";

export interface PortDef {
  id: string;
  side: "top" | "bottom" | "left" | "right";
  position: Position;
  /** Fractional position along the edge (0..1). */
  frac: number;
}

const range = (prefix: string, count: number, side: PortDef["side"], position: Position): PortDef[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    side,
    position,
    frac: (i + 1) / (count + 1),
  }));

export const PORTS: PortDef[] = [
  ...range("t", 5, "top", Position.Top),
  ...range("b", 5, "bottom", Position.Bottom),
  ...range("l", 3, "left", Position.Left),
  ...range("r", 3, "right", Position.Right),
];

const PORT_BY_ID = new Map(PORTS.map((p) => [p.id, p]));

/** Pixel offset of a port from a node's top-left corner. */
export function portOffset(portId: string, width: number, height: number): { x: number; y: number } {
  const port = PORT_BY_ID.get(portId);
  if (!port) return { x: width / 2, y: height / 2 };
  switch (port.side) {
    case "top":
      return { x: width * port.frac, y: 0 };
    case "bottom":
      return { x: width * port.frac, y: height };
    case "left":
      return { x: 0, y: height * port.frac };
    case "right":
      return { x: width, y: height * port.frac };
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Route {
  source: string;
  target: string;
  straight: boolean;
}

const ALIGN_TOLERANCE = 10; // px — one snapped grid row/column apart counts as misaligned

/**
 * Routing rule: boxes whose centres share a row get r1 → l1 (straight
 * horizontal); boxes sharing a column get b2 → t2 (straight vertical);
 * otherwise the facing mid-ports of the dominant axis with an orthogonal
 * (smoothstep) line.
 */
export function autoRoute(from: Box, to: Box): Route {
  const fromCx = from.x + from.w / 2;
  const fromCy = from.y + from.h / 2;
  const toCx = to.x + to.w / 2;
  const toCy = to.y + to.h / 2;
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  if (Math.abs(dy) <= ALIGN_TOLERANCE) {
    return dx >= 0
      ? { source: "r1", target: "l1", straight: true }
      : { source: "l1", target: "r1", straight: true };
  }
  if (Math.abs(dx) <= ALIGN_TOLERANCE) {
    return dy >= 0
      ? { source: "b2", target: "t2", straight: true }
      : { source: "t2", target: "b2", straight: true };
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { source: "r1", target: "l1", straight: false }
      : { source: "l1", target: "r1", straight: false };
  }
  return dy >= 0
    ? { source: "b2", target: "t2", straight: false }
    : { source: "t2", target: "b2", straight: false };
}

/** Are two pinned ports exactly in line (so the edge can render straight)? */
export function pinnedPortsAligned(
  fromBox: Box,
  toBox: Box,
  source: string,
  target: string,
): boolean {
  const a = portOffset(source, fromBox.w, fromBox.h);
  const b = portOffset(target, toBox.w, toBox.h);
  const ax = fromBox.x + a.x;
  const ay = fromBox.y + a.y;
  const bx = toBox.x + b.x;
  const by = toBox.y + b.y;
  return Math.abs(ax - bx) <= 1 || Math.abs(ay - by) <= 1;
}
