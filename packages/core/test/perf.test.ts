import { describe, expect, it } from "vitest";
import { seededUlidFactory } from "../src/ids.js";
import { CommandBus } from "../src/commands/bus.js";
import { Workspace } from "../src/model/workspace.js";
import { workspaceFromFiles, workspaceToFiles } from "../src/serialize/files.js";
import { visibleElements, visibleRelationships } from "../src/temporal/engine.js";
import { egoNetwork, lintWorkspace } from "../src/analysis/graph.js";
import type { Element } from "../src/metamodel/types.js";

/**
 * M9 performance pass: a 1,000-element model (100 systems × 9 containers,
 * plus actors) with ~1,300 relationships must stay responsive through the
 * hot paths — command dispatch, serialise, load+validate, temporal
 * evaluation, graph analysis. Thresholds are deliberately generous so the
 * test guards against O(n²) regressions, not CI machine variance.
 */

function buildLargeWorkspace() {
  const ids = seededUlidFactory(1234);
  const ws = new Workspace({ name: "Big estate" });
  const bus = new CommandBus(ws);
  const systems: Element[] = [];

  for (let s = 0; s < 100; s++) {
    const system: Element = {
      id: ids.next(),
      kind: "system",
      name: `System ${s}`,
      parentId: null,
      tags: s % 5 === 0 ? ["legacy"] : ["core"],
      ...(s % 7 === 0 ? { temporal: { validTo: "2027-12-31" } } : {}),
    };
    bus.dispatch({ type: "createElement", element: system });
    systems.push(system);
    for (let c = 0; c < 9; c++) {
      bus.dispatch({
        type: "createElement",
        element: {
          id: ids.next(),
          kind: "container",
          name: `System ${s} / Container ${c}`,
          parentId: system.id,
          technology: ["TypeScript"],
        },
      });
    }
  }
  // Cross-system relationships: each system talks to the next 3.
  for (let s = 0; s < 100; s++) {
    for (let step = 1; step <= 3; step++) {
      bus.dispatch({
        type: "createRelationship",
        relationship: {
          id: ids.next(),
          sourceId: systems[s]!.id,
          targetId: systems[(s + step) % 100]!.id,
          name: "calls",
        },
      });
    }
  }
  // A landscape with 100 systems placed.
  bus.dispatch({
    type: "createView",
    view: {
      id: ids.next(),
      kind: "landscape",
      name: "Landscape",
      scopeId: null,
      placements: systems.map((sys, i) => ({
        elementId: sys.id,
        x: (i % 10) * 13,
        y: Math.floor(i / 10) * 8,
      })),
    },
  });
  return { ws, bus, ids, systems };
}

const time = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

describe("performance pass (1,000-element model)", () => {
  it("builds 1,000 elements + 300 relationships through the bus in bounded time", () => {
    const elapsed = time(() => {
      const { ws } = buildLargeWorkspace();
      expect(ws.elements.size).toBe(1000);
      expect(ws.relationships.size).toBe(300);
    });
    expect(elapsed).toBeLessThan(5000);
  });

  it("serialises, reloads (with schema validation) and re-serialises byte-identically in bounded time", () => {
    const { ws } = buildLargeWorkspace();
    let files!: ReturnType<typeof workspaceToFiles>;
    const serialise = time(() => {
      files = workspaceToFiles(ws);
    });
    expect(files.size).toBe(1302); // manifest + 1000 elements + 300 rels + 1 view
    let loaded!: Workspace;
    const load = time(() => {
      loaded = workspaceFromFiles(files);
    });
    expect([...workspaceToFiles(loaded).keys()]).toEqual([...files.keys()]);
    expect(serialise).toBeLessThan(3000);
    expect(load).toBeLessThan(5000);
  });

  it("temporal evaluation and graph analysis stay fast at estate scale", () => {
    const { ws, systems } = buildLargeWorkspace();
    const temporal = time(() => {
      const visible = visibleElements(ws, { type: "date", date: "2028-06-01" });
      visibleRelationships(ws, { type: "date", date: "2028-06-01" }, visible);
    });
    const ego = time(() => {
      egoNetwork(ws, systems[0]!.id, { depth: 3 });
    });
    const lint = time(() => {
      lintWorkspace(ws);
    });
    expect(temporal).toBeLessThan(1000);
    expect(ego).toBeLessThan(500);
    expect(lint).toBeLessThan(2000);
  });

  it("single-command dispatch (the interactive path) is sub-frame even at scale", () => {
    const { ws, bus, ids } = buildLargeWorkspace();
    const elapsed = time(() => {
      bus.dispatch({
        type: "createElement",
        element: { id: ids.next(), kind: "system", name: "One more", parentId: null },
      });
      bus.undo();
    });
    expect(ws.elements.size).toBe(1000);
    expect(elapsed).toBeLessThan(50);
  });
});
