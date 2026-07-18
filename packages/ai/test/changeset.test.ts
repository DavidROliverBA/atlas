import { describe, expect, it } from "vitest";
import { CommandBus, Workspace, seededUlidFactory } from "@atlas/core";
import { ChangeSetBuilder, ToolError } from "../src/changeset.js";
import { buildModelSummary, describeElement } from "../src/summary.js";

function seed() {
  const ids = seededUlidFactory(9);
  const ws = new Workspace({ name: "Test" });
  const bus = new CommandBus(ws);
  const booking = { id: ids.next(), kind: "system" as const, name: "Booking Engine", parentId: null };
  const payments = { id: ids.next(), kind: "system" as const, name: "Payments", parentId: null };
  bus.dispatch({ type: "createElement", element: booking });
  bus.dispatch({ type: "createElement", element: payments });
  const view = { id: ids.next(), kind: "landscape" as const, name: "Landscape", scopeId: null, placements: [] };
  bus.dispatch({ type: "createView", view });
  return { ids, ws, bus, booking, payments, view };
}

describe("ChangeSetBuilder", () => {
  it("queues commands without touching the live workspace, then applies as one batch", () => {
    const { ids, ws, bus, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);

    const crm = builder.createElement({ name: "CRM", kind: "system", description: "Loyalty" });
    builder.createRelationship({ source: "Booking Engine", target: "CRM", name: "updates" });
    builder.placeOnView(["CRM"]);

    // Live workspace untouched until Apply.
    expect(ws.elements.has(crm.id)).toBe(false);
    expect(ws.relationships.size).toBe(0);

    const batch = builder.toBatch("AI proposal")!;
    bus.dispatch(batch);
    expect(ws.elements.get(crm.id)?.name).toBe("CRM");
    expect(ws.relationships.size).toBe(1);
    expect(ws.view(view.id).placements.some((p) => p.elementId === crm.id)).toBe(true);

    // Single undo step reverts the whole proposal.
    bus.undo();
    expect(ws.elements.has(crm.id)).toBe(false);
    expect(ws.relationships.size).toBe(0);
  });

  it("later tool calls can reference earlier creations by name", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.createElement({ name: "Data Lake", kind: "system" });
    builder.createElement({ name: "Ingest API", kind: "container", parent: "Data Lake" });
    expect(builder.commands).toHaveLength(2);
  });

  it("surfaces metamodel violations as errors the AI can read", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    expect(() => builder.createElement({ name: "Rogue", kind: "component", parent: "Booking Engine" })).toThrow(
      /cannot live/,
    );
    expect(() => builder.resolveElement("Nonexistent")).toThrow(ToolError);
    // Failed calls leave nothing queued.
    expect(builder.commands).toHaveLength(0);
  });

  it("moves tagged elements via update with parent resolution", () => {
    const { ids, ws, bus, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.createElement({ name: "Legacy Zone", kind: "group" });
    builder.updateElement("Payments", { parentId: builder.resolveElement("Legacy Zone").id });
    bus.dispatch(builder.toBatch("move")!);
    const payments = [...ws.elements.values()].find((e) => e.name === "Payments")!;
    expect(ws.element(payments.parentId!).name).toBe("Legacy Zone");
  });
});

describe("model summary", () => {
  it("is compact and covers elements, relationships, views", () => {
    const { ws } = seed();
    const summary = buildModelSummary(ws);
    expect(summary).toContain("Booking Engine");
    expect(summary).toContain('"Landscape" (landscape');
    expect(summary.length).toBeLessThan(2000);
  });

  it("describes a single element with relationships and views", () => {
    const { ws } = seed();
    expect(describeElement(ws, "booking engine")).toContain("[system]");
    expect(describeElement(ws, "nope")).toBeNull();
  });
});
