import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CommandBus,
  Workspace,
  seededUlidFactory,
  workspaceToFiles,
} from "@atlas/core";
import { diffDirs, exportView, validateDir } from "../src/index.js";

function writeWorkspace(mutate?: (ws: Workspace, bus: CommandBus, ids: ReturnType<typeof seededUlidFactory>) => void): string {
  const ids = seededUlidFactory(3);
  const ws = new Workspace({ name: "CLI test estate" });
  const bus = new CommandBus(ws);
  const booking = { id: ids.next(), kind: "system" as const, name: "Booking", parentId: null };
  const crm = { id: ids.next(), kind: "system" as const, name: "CRM", parentId: null };
  bus.dispatch({ type: "createElement", element: booking });
  bus.dispatch({ type: "createElement", element: crm });
  bus.dispatch({
    type: "createRelationship",
    relationship: { id: ids.next(), sourceId: booking.id, targetId: crm.id, name: "updates" },
  });
  bus.dispatch({
    type: "createView",
    view: {
      id: ids.next(),
      kind: "landscape",
      name: "Landscape",
      scopeId: null,
      placements: [
        { elementId: booking.id, x: 0, y: 0 },
        { elementId: crm.id, x: 14, y: 0 },
      ],
    },
  });
  mutate?.(ws, bus, ids);

  const dir = mkdtempSync(join(tmpdir(), "atlas-cli-"));
  for (const [path, content] of workspaceToFiles(ws)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("atlas CLI", () => {
  it("validates a clean workspace with no errors", () => {
    const dir = writeWorkspace();
    const result = validateDir(dir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports schema violations with file context", () => {
    const dir = writeWorkspace();
    writeFileSync(
      join(dir, "model", "elements", "01ARZ3NDEKTSV4RRFFQ69G5FAV.json"),
      JSON.stringify({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", kind: "martian", name: "X", parentId: null }),
    );
    const result = validateDir(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("Schema validation failed");
  });

  it("diffs two workspace directories semantically", () => {
    const dirA = writeWorkspace();
    const dirB = writeWorkspace((ws, bus, ids) => {
      bus.dispatch({
        type: "createElement",
        element: { id: ids.next(), kind: "system", name: "Data Platform", parentId: null },
      });
      const crm = [...ws.elements.values()].find((e) => e.name === "CRM")!;
      bus.dispatch({ type: "updateElement", id: crm.id, changes: { status: "deprecated" } });
    });
    const lines = diffDirs(dirA, dirB);
    expect(lines.join("\n")).toContain('+ element "Data Platform"');
    expect(lines.join("\n")).toContain('~ element "CRM": status');
  });

  it("identical directories diff to nothing", () => {
    const dirA = writeWorkspace();
    const dirB = writeWorkspace();
    expect(diffDirs(dirA, dirB)).toEqual(["No differences."]);
  });

  it("exports Mermaid C4 and PlantUML C4 for a view", () => {
    const dir = writeWorkspace();
    const mermaid = exportView(dir, "mermaid");
    expect(mermaid).toContain("C4Context");
    expect(mermaid).toContain('"Booking"');
    expect(mermaid).toContain('"updates"');

    const plantuml = exportView(dir, "plantuml", "Landscape");
    expect(plantuml).toContain("@startuml");
    expect(plantuml).toContain("C4_Context.puml");
    expect(plantuml).toContain('System(');
    expect(plantuml).toContain("@enduml");
  });
});
