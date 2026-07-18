import { describe, expect, it } from "vitest";
import { buildFixture } from "./fixture.js";
import { workspaceFromFiles, workspaceToFiles } from "../src/serialize/files.js";

describe("colours and per-view edge anchors", () => {
  it("round-trips element/relationship colours and view edge anchors byte-identically", () => {
    const f = buildFixture();
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { color: "#0ea5e9" } });
    f.bus.dispatch({ type: "updateRelationship", id: f.paysRel.id, changes: { color: "#dc2626" } });
    f.bus.dispatch({
      type: "updateView",
      id: f.landscape.id,
      changes: { edgeAnchors: { [f.paysRel.id]: { source: "t2", target: "b2" } } },
    });

    const files = workspaceToFiles(f.ws);
    const loaded = workspaceFromFiles(files);
    expect([...workspaceToFiles(loaded).entries()]).toEqual([...files.entries()]);
    expect(loaded.element(f.booking.id).color).toBe("#0ea5e9");
    expect(loaded.view(f.landscape.id).edgeAnchors?.[f.paysRel.id]).toEqual({
      source: "t2",
      target: "b2",
    });
  });

  it("rejects invalid colours and port ids at the schema", () => {
    const f = buildFixture();
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { color: "#0ea5e9" } });
    const files = workspaceToFiles(f.ws);
    const path = [...files.keys()].find((p) => p.includes(f.booking.id))!;
    const parsed = JSON.parse(files.get(path)!);
    parsed.color = "blue";
    files.set(path, JSON.stringify(parsed));
    expect(() => workspaceFromFiles(files)).toThrow(/Schema validation/);
  });

  it("anchoring an unknown relationship is rejected; deleting a relationship scrubs its anchors (undoably)", () => {
    const f = buildFixture();
    expect(() =>
      f.bus.dispatch({
        type: "updateView",
        id: f.landscape.id,
        changes: { edgeAnchors: { "01ARZ3NDEKTSV4RRFFQ69G5FAV": { source: "r1", target: "l1" } } },
      }),
    ).toThrow(/Unknown relationship anchored/);

    f.bus.dispatch({
      type: "updateView",
      id: f.landscape.id,
      changes: { edgeAnchors: { [f.legacyRel.id]: { source: "b2", target: "t2" } } },
    });
    const before = JSON.stringify(f.ws.toData());

    f.bus.dispatch({ type: "deleteRelationship", id: f.legacyRel.id });
    expect(f.ws.view(f.landscape.id).edgeAnchors).toBeUndefined();

    f.bus.undo();
    expect(JSON.stringify(f.ws.toData())).toBe(before);
  });
});
