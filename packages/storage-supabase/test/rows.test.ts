import { describe, expect, it } from "vitest";
import {
  CommandBus,
  Workspace,
  seededUlidFactory,
  workspaceToFiles,
} from "@atlas/core";
import { dataToRows, rowsToData } from "../src/rows.js";

const WORKSPACE_ID = "3f0f8f6a-0000-4000-8000-000000000001";

function buildWorkspace(): Workspace {
  const ids = seededUlidFactory(21);
  const ws = new Workspace({
    name: "DB estate",
    description: "Round-trip test",
    stencilPacks: ["aws@1", "c4-core@1"],
  });
  const bus = new CommandBus(ws);
  const booking = {
    id: ids.next(),
    kind: "system" as const,
    name: "Booking",
    parentId: null,
    description: "Core",
    technology: ["Kotlin"],
    tags: ["core"],
    links: [{ title: "Repo", url: "https://example.com/repo" }],
    properties: { costCentre: "C123" },
    temporal: { validFrom: "2020-01-01" },
    costs: [
      {
        id: ids.next(),
        label: "Booking support team",
        category: "people" as const,
        classification: "run" as const,
        kind: "recurring" as const,
        amount: 400000,
      },
    ],
  };
  const api = {
    id: ids.next(),
    kind: "container" as const,
    name: "API",
    parentId: booking.id,
    stencil: { pack: "aws", stencil: "lambda", attributes: { region: "eu-west-2" } },
  };
  bus.dispatch({ type: "createElement", element: booking });
  bus.dispatch({ type: "createElement", element: api });
  bus.dispatch({
    type: "createRelationship",
    relationship: {
      id: ids.next(),
      sourceId: booking.id,
      targetId: api.id,
      name: "contains flow",
      direction: "bidirectional",
      technology: ["HTTPS"],
    },
  });
  const state = { id: ids.next(), name: "Target", date: "2028-01-01" };
  bus.dispatch({ type: "createState", state });
  bus.dispatch({
    type: "updateElement",
    id: api.id,
    changes: { stateOverrides: { [state.id]: { technology: ["Rust"] } } },
  });
  bus.dispatch({
    type: "createView",
    view: {
      id: ids.next(),
      kind: "container",
      name: "Containers",
      scopeId: booking.id,
      renderMode: "isometric",
      placements: [{ elementId: api.id, x: 3, y: 4, width: 10 }],
    },
  });
  return ws;
}

describe("workspace ↔ rows mapping", () => {
  it("round-trips every field through the normalised row shape", () => {
    const ws = buildWorkspace();
    const rows = dataToRows(ws.toData(), WORKSPACE_ID);
    const back = Workspace.fromData(rowsToData(rows));

    // Byte-identical via the canonical serialiser — the strongest equality we have.
    expect([...workspaceToFiles(back).entries()]).toEqual([...workspaceToFiles(ws).entries()]);
  });

  it("normalises placements into a join table keyed by (view, element)", () => {
    const ws = buildWorkspace();
    const rows = dataToRows(ws.toData(), WORKSPACE_ID);
    expect(rows.placements).toHaveLength(1);
    expect(rows.placements[0]).toMatchObject({ x: 3, y: 4, width: 10, height: null });
    expect(rows.views[0]?.render_mode).toBe("isometric");
  });

  it("keeps jsonb columns null when the model omits them", () => {
    const ws = buildWorkspace();
    const rows = dataToRows(ws.toData(), WORKSPACE_ID);
    const booking = rows.elements.find((e) => e.name === "Booking")!;
    expect(booking.stencil).toBeNull();
    expect(booking.state_overrides).toBeNull();
    expect(booking.costs).toMatchObject([{ label: "Booking support team", amount: 400000 }]);
    const api = rows.elements.find((e) => e.name === "API")!;
    expect(api.stencil).toMatchObject({ pack: "aws", stencil: "lambda" });
    expect(api.costs).toBeNull();
  });
});
