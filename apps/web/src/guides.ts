/**
 * Alignment guides: while a box is dragged, compare its left/centre/right and
 * top/middle/bottom lines against every other box on the view and emit a
 * dashed guide segment for each match, spanning both boxes.
 */

import type { Box } from "./ports";

export interface GuideSegment {
  axis: "v" | "h";
  /** Flow-space coordinate of the guide line (x for vertical, y for horizontal). */
  pos: number;
  from: number;
  to: number;
}

const TOLERANCE = 2; // px — grid snapping makes true alignment exact
const OVERSHOOT = 16;

export function computeGuides(moving: Box, others: Box[]): GuideSegment[] {
  const found = new Map<string, GuideSegment>();

  const add = (axis: "v" | "h", pos: number, from: number, to: number): void => {
    const key = `${axis}:${Math.round(pos)}`;
    const existing = found.get(key);
    if (existing) {
      existing.from = Math.min(existing.from, from);
      existing.to = Math.max(existing.to, to);
    } else {
      found.set(key, { axis, pos, from, to });
    }
  };

  for (const other of others) {
    const vSpan: [number, number] = [
      Math.min(moving.y, other.y) - OVERSHOOT,
      Math.max(moving.y + moving.h, other.y + other.h) + OVERSHOOT,
    ];
    const hSpan: [number, number] = [
      Math.min(moving.x, other.x) - OVERSHOOT,
      Math.max(moving.x + moving.w, other.x + other.w) + OVERSHOOT,
    ];

    const vertical: Array<[number, number]> = [
      [moving.x, other.x],
      [moving.x + moving.w / 2, other.x + other.w / 2],
      [moving.x + moving.w, other.x + other.w],
    ];
    for (const [a, b] of vertical) {
      if (Math.abs(a - b) <= TOLERANCE) add("v", b, vSpan[0], vSpan[1]);
    }

    const horizontal: Array<[number, number]> = [
      [moving.y, other.y],
      [moving.y + moving.h / 2, other.y + other.h / 2],
      [moving.y + moving.h, other.y + other.h],
    ];
    for (const [a, b] of horizontal) {
      if (Math.abs(a - b) <= TOLERANCE) add("h", b, hSpan[0], hSpan[1]);
    }
  }
  return [...found.values()];
}
