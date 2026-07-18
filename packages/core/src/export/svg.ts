/**
 * Standalone SVG export of a view (§3.9) — pure string builder, no DOM.
 * Renders the same scene graph as the 2D canvas: rounded boxes on the grid,
 * straight labelled connectors. Deterministic output (sorted by id).
 */

import type { Ulid } from "../ids.js";
import type { Element } from "../metamodel/types.js";
import type { Workspace } from "../model/workspace.js";

const GRID = 20;
const DEFAULT_W = 9;
const DEFAULT_H = 5;
const GROUP_W = 18;
const GROUP_H = 12;

const FILL: Record<Element["kind"], { bg: string; border: string }> = {
  person: { bg: "#f5f3ff", border: "#a78bfa" },
  system: { bg: "#f0f9ff", border: "#38bdf8" },
  container: { bg: "#f0fdfa", border: "#2dd4bf" },
  component: { bg: "#fffbeb", border: "#fbbf24" },
  group: { bg: "#f8fafc", border: "#94a3b8" },
};

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toSvg(ws: Workspace, viewId: Ulid): string {
  const view = ws.view(viewId);
  const boxes = [...view.placements]
    .sort((a, b) => (a.elementId < b.elementId ? -1 : 1))
    .map((p) => {
      const el = ws.elements.get(p.elementId);
      if (!el) return null;
      const isGroup = el.kind === "group";
      return {
        el,
        x: p.x * GRID,
        y: p.y * GRID,
        w: (p.width ?? (isGroup ? GROUP_W : DEFAULT_W)) * GRID,
        h: (p.height ?? (isGroup ? GROUP_H : DEFAULT_H)) * GRID,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  const byId = new Map(boxes.map((b) => [b.el.id, b]));
  const parts: string[] = [];

  // Groups first (background), then elements.
  for (const b of [...boxes].sort((a, c) => Number(c.el.kind === "group") - Number(a.el.kind === "group"))) {
    const fill = FILL[b.el.kind];
    const dash = b.el.kind === "group" ? ' stroke-dasharray="6 4"' : "";
    parts.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="${fill.bg}" stroke="${fill.border}" stroke-width="2"${dash}/>`,
      `<text x="${b.x + 12}" y="${b.y + 22}" font-size="13" font-weight="600" fill="#0f172a" font-family="system-ui,sans-serif">${esc(b.el.name)}</text>`,
    );
    if (b.el.kind !== "group") {
      const subtitle = [b.el.kind, ...(b.el.technology ?? [])].join(" · ");
      parts.push(
        `<text x="${b.x + 12}" y="${b.y + 38}" font-size="10" fill="#64748b" font-family="system-ui,sans-serif">${esc(subtitle)}</text>`,
      );
    }
  }

  for (const r of [...ws.relationships.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (view.hiddenRelationshipIds?.includes(r.id)) continue;
    const from = byId.get(r.sourceId);
    const to = byId.get(r.targetId);
    if (!from || !to) continue;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h / 2;
    const x2 = to.x + to.w / 2;
    const y2 = to.y + to.h / 2;
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    );
    if (r.name) {
      parts.push(
        `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" font-size="10" fill="#334155" text-anchor="middle" font-family="system-ui,sans-serif">${esc(r.name)}</text>`,
      );
    }
  }

  const minX = Math.min(0, ...boxes.map((b) => b.x)) - 40;
  const minY = Math.min(0, ...boxes.map((b) => b.y)) - 40;
  const maxX = Math.max(200, ...boxes.map((b) => b.x + b.w)) + 40;
  const maxY = Math.max(200, ...boxes.map((b) => b.y + b.h)) + 40;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX - minX}" height="${maxY - minY}" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">` +
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>` +
    `<title>${esc(view.name)}</title>` +
    parts.join("") +
    `</svg>`
  );
}
