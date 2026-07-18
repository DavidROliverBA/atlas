/**
 * Automated connections view (§3.5): a radially laid-out ego network for any
 * element, computed from the whole model — never drawn by hand. Depth,
 * direction and tag filters re-run the graph query live.
 */

import { useMemo, useState } from "react";
import { egoNetwork, type DirectionFilter, type Ulid } from "@atlas/core";
import { motion } from "framer-motion";
import { stencilFor, KIND_LABELS } from "../stencils";
import { useAtlas } from "../store";

const RING = 190;
const NODE_W = 150;
const NODE_H = 54;

export function ConnectionsView({ centerId, onClose }: { centerId: Ulid; onClose: () => void }) {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const select = useAtlas((s) => s.select);

  const [depth, setDepth] = useState(1);
  const [direction, setDirection] = useState<DirectionFilter>("both");
  const [tagFilter, setTagFilter] = useState("");

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const r of ws.relationships.values()) for (const t of r.tags ?? []) tags.add(t);
    return [...tags].sort();
  }, [ws]);

  const scene = useMemo(() => {
    if (!ws.elements.has(centerId)) return null;
    const network = egoNetwork(ws, centerId, {
      depth,
      direction,
      tags: tagFilter ? [tagFilter] : undefined,
    });

    // Radial layout: hop 0 at the centre, each hop on a larger ring.
    const byHop = new Map<number, Ulid[]>();
    for (const [id, hop] of network.elements) {
      byHop.set(hop, [...(byHop.get(hop) ?? []), id]);
    }
    const pos = new Map<Ulid, { x: number; y: number }>();
    for (const [hop, ids] of byHop) {
      if (hop === 0) {
        pos.set(ids[0]!, { x: 0, y: 0 });
        continue;
      }
      ids.sort();
      ids.forEach((id, i) => {
        const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2;
        pos.set(id, { x: Math.cos(angle) * RING * hop, y: Math.sin(angle) * RING * hop });
      });
    }
    const extent = Math.max(1, ...[...network.elements.values()]) * RING + 140;
    return { network, pos, extent };
  }, [ws, centerId, depth, direction, tagFilter]);

  if (!scene) return null;
  const centre = ws.element(centerId);

  return (
    <motion.div
      data-testid="connections-view"
      className="fixed inset-0 z-40 flex flex-col bg-slate-900/60 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="m-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">
            Connections — {centre.name}
            <span className="ml-2 text-xs font-normal text-slate-400">
              every relationship across the estate
            </span>
          </h2>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Depth
            <select
              data-testid="connections-depth"
              className="rounded border border-slate-300 px-1 py-0.5 text-xs"
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
            >
              {[1, 2, 3, 4].map((d) => (
                <option key={d} value={d}>
                  {d} hop{d > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Direction
            <select
              data-testid="connections-direction"
              className="rounded border border-slate-300 px-1 py-0.5 text-xs"
              value={direction}
              onChange={(e) => setDirection(e.target.value as DirectionFilter)}
            >
              <option value="both">both</option>
              <option value="out">outgoing</option>
              <option value="in">incoming</option>
            </select>
          </label>
          {allTags.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Tag
              <select
                data-testid="connections-tag"
                className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                <option value="">any</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="flex-1" />
          <button
            data-testid="connections-close"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50">
          <svg
            viewBox={`${-scene.extent} ${-scene.extent} ${scene.extent * 2} ${scene.extent * 2}`}
            className="h-full w-full"
          >
            {scene.network.relationships.map((rel) => {
              const from = scene.pos.get(rel.sourceId);
              const to = scene.pos.get(rel.targetId);
              if (!from || !to) return null;
              return (
                <g key={rel.id}>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#94a3b8" strokeWidth={1.5} />
                  {rel.name && (
                    <text
                      x={(from.x + to.x) / 2}
                      y={(from.y + to.y) / 2 - 5}
                      textAnchor="middle"
                      style={{ fontSize: 10, fill: "#64748b" }}
                    >
                      {rel.name}
                    </text>
                  )}
                </g>
              );
            })}
            {[...scene.network.elements.entries()].map(([id, hop]) => {
              const p = scene.pos.get(id);
              const el = ws.elements.get(id);
              if (!p || !el) return null;
              const stencil = stencilFor(el.kind);
              return (
                <g
                  key={id}
                  data-testid="connections-node"
                  data-elname={el.name}
                  className="cursor-pointer"
                  onClick={() => select({ type: "element", id })}
                >
                  <foreignObject x={p.x - NODE_W / 2} y={p.y - NODE_H / 2} width={NODE_W} height={NODE_H}>
                    <div
                      className={`flex h-full flex-col justify-center rounded-lg border-2 px-2 py-1 shadow-sm ${stencil.nodeClass} ${
                        hop === 0 ? "ring-2 ring-blue-500" : ""
                      }`}
                    >
                      <div className="truncate text-xs font-semibold">{el.name}</div>
                      <div className="text-[9px] uppercase tracking-wide opacity-60">
                        {KIND_LABELS[el.kind]}
                        {hop > 0 ? ` · ${hop} hop${hop > 1 ? "s" : ""}` : ""}
                      </div>
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </motion.div>
  );
}
