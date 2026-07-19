/**
 * On-demand auto-layout (brief §3.3: "optional auto-layout (ELK.js) on
 * demand, never forced"). Runs ELK's layered algorithm over the current
 * view and applies the result as one undoable batch of placement updates.
 */

import type { Command, Ulid, Workspace } from "@atlas/core";
import { DEFAULT_H, DEFAULT_W, GRID } from "./store";

// elkjs is a sizeable dependency only needed when the user actually asks for
// auto-layout, so it's loaded on first use instead of on the initial bundle.
type Elk = InstanceType<typeof import("elkjs/lib/elk.bundled.js").default>;
let elkPromise: Promise<Elk> | undefined;
async function loadElk(): Promise<Elk> {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled.js").then((m) => new m.default());
  }
  return elkPromise;
}

export async function autoLayoutCommands(ws: Workspace, viewId: Ulid): Promise<Command | null> {
  const view = ws.views.get(viewId);
  if (!view || view.placements.length < 2) return null;

  const placed = new Set(view.placements.map((p) => p.elementId));
  const children = view.placements
    .filter((p) => ws.elements.get(p.elementId))
    .map((p) => ({
      id: p.elementId,
      width: (p.width ?? DEFAULT_W) * GRID,
      height: (p.height ?? DEFAULT_H) * GRID,
    }));
  const edges = [...ws.relationships.values()]
    .filter((r) => placed.has(r.sourceId) && placed.has(r.targetId))
    .map((r) => ({ id: r.id, sources: [r.sourceId], targets: [r.targetId] }));

  const elk = await loadElk();
  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    },
    children,
    edges,
  });

  const commands: Command[] = [];
  for (const child of result.children ?? []) {
    // Snap ELK's px output back onto the grid so straight-line routing applies.
    commands.push({
      type: "updatePlacement",
      viewId,
      elementId: child.id as Ulid,
      changes: {
        x: Math.round((child.x ?? 0) / GRID),
        y: Math.round((child.y ?? 0) / GRID),
      },
    });
  }
  return commands.length ? { type: "batch", label: "Auto-layout", commands } : null;
}
