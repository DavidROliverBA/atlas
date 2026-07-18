/**
 * Isometric projection of a view (§3.3). Consumes exactly the same placements
 * as the 2D canvas — grid units, no separate layout — and projects them with
 * the classic 2:1 dimetric transform. Read-mostly in v1: click to select,
 * layout edits happen in 2D (see ADR 0003).
 */

import { useMemo } from "react";
import {
  effectiveElement,
  visibleElements,
  visibleRelationships,
  type Element,
  type Placement,
  type Relationship,
} from "@atlas/core";
import { motion } from "framer-motion";
import { DEFAULT_H, DEFAULT_W, useAtlas } from "../store";

const TILE = 14; // px per grid unit on the iso plane
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/** Project grid coordinates (units) onto the iso plane (px). */
function iso(x: number, y: number): { px: number; py: number } {
  return { px: (x - y) * COS30 * TILE, py: (x + y) * SIN30 * TILE };
}

const KIND_STYLE: Record<
  Element["kind"],
  { top: string; left: string; right: string; height: number }
> = {
  person: { top: "#ddd6fe", left: "#a78bfa", right: "#8b5cf6", height: 34 },
  system: { top: "#bae6fd", left: "#38bdf8", right: "#0ea5e9", height: 28 },
  container: { top: "#99f6e4", left: "#2dd4bf", right: "#14b8a6", height: 22 },
  component: { top: "#fde68a", left: "#fbbf24", right: "#f59e0b", height: 16 },
  group: { top: "#f1f5f9", left: "#cbd5e1", right: "#94a3b8", height: 2 },
};

interface IsoNodeDatum {
  element: Element;
  placement: Placement;
  cx: number;
  cy: number;
  depth: number;
}

function IsoBox({ datum, selected, onSelect }: { datum: IsoNodeDatum; selected: boolean; onSelect: () => void }) {
  const { element, placement } = datum;
  const style = KIND_STYLE[element.kind];
  const w = placement.width ?? (element.kind === "group" ? 18 : DEFAULT_W);
  const h = placement.height ?? (element.kind === "group" ? 12 : DEFAULT_H);
  const z = style.height;
  // The label runs along the face's model-x edge, whose projected length is w·TILE.
  const labelFit = fitLabel(element.name, w * TILE);

  // Four corners of the footprint, projected.
  const a = iso(placement.x, placement.y); // back
  const b = iso(placement.x + w, placement.y); // right
  const c = iso(placement.x + w, placement.y + h); // front
  const d = iso(placement.x, placement.y + h); // left

  const lift = (p: { px: number; py: number }) => `${p.px},${p.py - z}`;
  const flat = (p: { px: number; py: number }) => `${p.px},${p.py}`;

  return (
    <g
      data-testid="iso-node"
      data-elname={element.name}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className="cursor-pointer"
      style={{ filter: selected ? "drop-shadow(0 0 6px #2563eb)" : undefined }}
    >
      {/* top face */}
      <polygon
        points={`${lift(a)} ${lift(b)} ${lift(c)} ${lift(d)}`}
        fill={style.top}
        stroke={selected ? "#2563eb" : "#475569"}
        strokeWidth={selected ? 2 : 1}
      />
      {z > 2 && (
        <>
          {/* left face (d–c edge) */}
          <polygon
            points={`${lift(d)} ${lift(c)} ${flat(c)} ${flat(d)}`}
            fill={style.left}
            stroke="#475569"
            strokeWidth={0.5}
          />
          {/* right face (c–b edge) */}
          <polygon
            points={`${lift(c)} ${lift(b)} ${flat(b)} ${flat(c)}`}
            fill={style.right}
            stroke="#475569"
            strokeWidth={0.5}
          />
        </>
      )}
      {/*
        The label lies on the top face: the matrix maps the text's x-axis
        along the iso grid's +x direction and its y-axis along +y, so the
        baseline slants at the same angle as the box edges instead of
        floating horizontally above the tile. Long names shrink (and as a
        last resort squeeze via textLength) to stay within the face.
      */}
      <g
        transform={`translate(${datum.cx}, ${datum.cy - z}) matrix(${COS30}, ${SIN30}, ${-COS30}, ${SIN30}, 0, 0)`}
      >
        <text
          data-testid="iso-label"
          textAnchor="middle"
          dominantBaseline="central"
          className="select-none"
          style={{ fontSize: labelFit.fontSize, fontWeight: 600, fill: "#0f172a" }}
          {...(labelFit.squeeze ? { textLength: labelFit.available, lengthAdjust: "spacingAndGlyphs" } : {})}
        >
          {element.name}
        </text>
      </g>
    </g>
  );
}

/** Average glyph width as a fraction of font size (600-weight system-ui). */
const GLYPH_RATIO = 0.6;
const MAX_LABEL_FONT = 10.5;
const MIN_LABEL_FONT = 7;

/**
 * Fit a name to the face-edge length it lies along: shrink the font first,
 * then squeeze glyph spacing if the minimum font still overflows.
 */
function fitLabel(name: string, faceLengthPx: number): { fontSize: number; available: number; squeeze: boolean } {
  const available = Math.max(24, faceLengthPx - 16);
  const idealFont = available / (GLYPH_RATIO * Math.max(1, name.length));
  const fontSize = Math.min(MAX_LABEL_FONT, Math.max(MIN_LABEL_FONT, idealFont));
  const squeeze = name.length * fontSize * GLYPH_RATIO > available;
  return { fontSize, available, squeeze };
}

export function IsoCanvas() {
  const ws = useAtlas((s) => s.ws);
  const rev = useAtlas((s) => s.rev);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const selection = useAtlas((s) => s.selection);
  const select = useAtlas((s) => s.select);

  const temporal = useAtlas((s) => s.temporal);

  const scene = useMemo(() => {
    const view = ws.views.get(activeViewId);
    if (!view) return null;
    const vis = temporal.type !== "all" ? visibleElements(ws, temporal) : null;
    const visRels = vis ? visibleRelationships(ws, temporal, vis) : null;
    const nodes: IsoNodeDatum[] = [];
    for (const p of view.placements) {
      const raw = ws.elements.get(p.elementId);
      if (!raw) continue;
      if (vis && !vis.has(raw.id)) continue;
      const element = effectiveElement(raw, temporal);
      const w = p.width ?? (element.kind === "group" ? 18 : DEFAULT_W);
      const h = p.height ?? (element.kind === "group" ? 12 : DEFAULT_H);
      const centre = iso(p.x + w / 2, p.y + h / 2);
      nodes.push({ element, placement: p, cx: centre.px, cy: centre.py, depth: p.x + p.y });
    }
    nodes.sort((m, n) => m.depth - n.depth);

    const placed = new Map(nodes.map((n) => [n.element.id, n]));
    const edges: Array<{ rel: Relationship; from: IsoNodeDatum; to: IsoNodeDatum }> = [];
    for (const rel of ws.relationships.values()) {
      if (visRels && !visRels.has(rel.id)) continue;
      const from = placed.get(rel.sourceId);
      const to = placed.get(rel.targetId);
      if (from && to && !view.hiddenRelationshipIds?.includes(rel.id)) {
        edges.push({ rel, from, to });
      }
    }

    const xs = nodes.flatMap((n) => [n.cx - 200, n.cx + 200]);
    const ys = nodes.flatMap((n) => [n.cy - 120, n.cy + 80]);
    const minX = Math.min(0, ...xs);
    const minY = Math.min(0, ...ys);
    const maxX = Math.max(300, ...xs);
    const maxY = Math.max(300, ...ys);
    return { nodes, edges, viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}` };
  }, [ws, rev, activeViewId, temporal]);

  if (!scene) return null;

  return (
    <motion.div
      className="h-full w-full bg-slate-100"
      data-testid="iso-canvas"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <svg
        viewBox={scene.viewBox}
        className="h-full w-full"
        onClick={() => select(null)}
        role="img"
        aria-label="Isometric view"
      >
        <defs>
          <marker id="iso-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
          </marker>
        </defs>
        {scene.edges.map(({ rel, from, to }) => (
          <g
            key={rel.id}
            data-testid="iso-edge"
            onClick={(e) => {
              e.stopPropagation();
              select({ type: "relationship", id: rel.id });
            }}
            className="cursor-pointer"
          >
            <line
              x1={from.cx}
              y1={from.cy - KIND_STYLE[from.element.kind].height / 2}
              x2={to.cx}
              y2={to.cy - KIND_STYLE[to.element.kind].height / 2}
              stroke={
                selection?.type === "relationship" && selection.id === rel.id
                  ? "#2563eb"
                  : rel.color ?? "#64748b"
              }
              strokeWidth={selection?.type === "relationship" && selection.id === rel.id ? 2.5 : 1.5}
              markerEnd="url(#iso-arrow)"
              {...(rel.direction === "bidirectional" ? { markerStart: "url(#iso-arrow)" } : {})}
            />
            {rel.name && (
              /* Line labels share the boxes' text plane, lifted above the line. */
              <g
                transform={`translate(${(from.cx + to.cx) / 2}, ${(from.cy + to.cy) / 2 - 10}) matrix(${COS30}, ${SIN30}, ${-COS30}, ${SIN30}, 0, 0)`}
              >
                <text
                  data-testid="iso-edge-label"
                  textAnchor="middle"
                  dominantBaseline="text-after-edge"
                  style={{ fontSize: 9.5, fill: rel.color ?? "#334155" }}
                  className="select-none"
                >
                  {rel.name}
                </text>
              </g>
            )}
          </g>
        ))}
        {scene.nodes.map((n) => (
          <IsoBox
            key={n.element.id}
            datum={n}
            selected={selection?.type === "element" && selection.id === n.element.id}
            onSelect={() => select({ type: "element", id: n.element.id })}
          />
        ))}
      </svg>
    </motion.div>
  );
}
