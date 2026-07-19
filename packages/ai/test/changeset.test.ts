import { describe, expect, it } from "vitest";
import {
  CommandBus,
  StencilRegistry,
  Workspace,
  elementAnnual,
  estateTco,
  seededUlidFactory,
  type StencilPack,
} from "@atlas/core";
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

const testStencilPack: StencilPack = {
  formatVersion: 1,
  id: "ai-agents",
  name: "AI Agents",
  version: "1.0.0",
  categories: [{ id: "containers", name: "Containers" }],
  stencils: [
    {
      id: "agent",
      name: "Agent",
      category: "containers",
      elementType: "container",
      symbol2d: "<svg/>",
      symbolIso: "<svg/>",
      attributeSchema: {
        type: "object",
        properties: { runtime: { type: "string" } },
        additionalProperties: false,
      },
    },
  ],
};

function testRegistry(): StencilRegistry {
  const registry = new StencilRegistry();
  registry.register(testStencilPack);
  return registry;
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

  it("sets, validates and clears cost entries with state-name resolution", () => {
    const { ids, ws, bus, view } = seed();
    bus.dispatch({ type: "createState", state: { id: ids.next(), name: "Target", date: "2028-01-01" } });
    const builder = new ChangeSetBuilder(ws, ids, view.id);

    const count = builder.setCosts({
      element: "Payments",
      costs: [
        { label: "Licence", category: "licences", classification: "run", kind: "recurring", amount: 42000 },
        {
          label: "Migration",
          category: "change",
          classification: "change",
          kind: "one-off",
          amount: 250000,
          states: ["Target"],
        },
      ],
    });
    expect(count).toBe(2);
    bus.dispatch(builder.toBatch("costs")!);
    const payments = [...ws.elements.values()].find((e) => e.name === "Payments")!;
    expect(payments.costs).toHaveLength(2);
    const targetId = [...ws.states.values()].find((s) => s.name === "Target")!.id;
    expect(payments.costs![1]!.states).toEqual([targetId]);

    // Invalid amounts and unknown states are rejected before anything is queued.
    const bad = new ChangeSetBuilder(ws, ids, view.id);
    expect(() =>
      bad.setCosts({
        element: "Payments",
        costs: [{ label: "Free", category: "other", classification: "run", kind: "recurring", amount: 0 }],
      }),
    ).toThrow(/greater than zero/);
    expect(() =>
      bad.setCosts({
        element: "Payments",
        costs: [
          { label: "X", category: "other", classification: "run", kind: "recurring", amount: 1, states: ["Nope"] },
        ],
      }),
    ).toThrow(ToolError);
    expect(bad.commands).toHaveLength(0);

    // Empty list clears the key entirely.
    const clearer = new ChangeSetBuilder(ws, ids, view.id);
    expect(clearer.setCosts({ element: "Payments", costs: [] })).toBe(0);
    bus.dispatch(clearer.toBatch("clear")!);
    expect([...ws.elements.values()].find((e) => e.name === "Payments")!.costs).toBeUndefined();
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

describe("ChangeSetBuilder — deletion and view removal", () => {
  it("cascades element deletion to children and relationships, with a summary reflecting counts", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    const legacy = builder.createElement({ name: "Legacy Mainframe", kind: "system" });
    builder.createElement({ name: "Legacy DB", kind: "container", parent: "Legacy Mainframe" });
    builder.createRelationship({ source: "Legacy Mainframe", target: "Booking Engine", name: "feeds" });

    builder.deleteElements(["Legacy Mainframe"]);

    // Clone loses the system, its child container, and the relationship.
    expect(builder.clone.elements.has(legacy.id)).toBe(false);
    expect([...builder.clone.elements.values()].some((e) => e.name === "Legacy DB")).toBe(false);
    expect(builder.clone.relationships.size).toBe(0);

    const deleteSummary = builder.summary.find((s) => s.description.startsWith('Delete system "Legacy Mainframe"'));
    expect(deleteSummary?.description).toMatch(/\+1 child\b/);
    expect(deleteSummary?.description).toMatch(/1 relationship\b/);
  });

  it("errors on ambiguous relationship deletion, listing candidates, and resolves once named", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.createRelationship({ source: "Booking Engine", target: "Payments", name: "charges via" });
    builder.createRelationship({ source: "Booking Engine", target: "Payments", name: "refunds via" });

    expect(() =>
      builder.deleteRelationships([{ source: "Booking Engine", target: "Payments" }]),
    ).toThrow(ToolError);
    try {
      builder.deleteRelationships([{ source: "Booking Engine", target: "Payments" }]);
      throw new Error("expected deleteRelationships to throw");
    } catch (err) {
      expect((err as Error).message).toContain("charges via");
      expect((err as Error).message).toContain("refunds via");
    }
    expect(builder.clone.relationships.size).toBe(2); // failed calls queue nothing

    builder.deleteRelationships([{ source: "Booking Engine", target: "Payments", name: "charges via" }]);
    expect(builder.clone.relationships.size).toBe(1);
    expect([...builder.clone.relationships.values()][0]!.name).toBe("refunds via");
  });

  it("removes a placement via remove_from_view without touching the element or other views", () => {
    const { ids, ws, bus, view, booking } = seed();
    bus.dispatch({ type: "placeOnView", viewId: view.id, placement: { elementId: booking.id, x: 0, y: 0 } });

    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.removeFromView(["Booking Engine"]);
    bus.dispatch(builder.toBatch("remove")!);

    expect(ws.elements.has(booking.id)).toBe(true);
    expect(ws.view(view.id).placements.some((p) => p.elementId === booking.id)).toBe(false);
  });

  it("errors cleanly when a later call references an already-deleted element", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.deleteElements(["Payments"]);
    expect(() => builder.createRelationship({ source: "Booking Engine", target: "Payments" })).toThrow(ToolError);
    expect(() => builder.resolveElement("Payments")).toThrow(ToolError);
  });

  it("applies a mixed delete/create/remove-from-view proposal as one batch and undoes it in a single step", () => {
    const { ids, ws, bus, view, booking, payments } = seed();
    bus.dispatch({
      type: "createRelationship",
      relationship: { id: ids.next(), sourceId: booking.id, targetId: payments.id, name: "charges via" },
    });
    bus.dispatch({ type: "placeOnView", viewId: view.id, placement: { elementId: booking.id, x: 0, y: 0 } });

    const beforeElementCount = ws.elements.size;
    const beforeRelCount = ws.relationships.size;

    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.deleteElements(["Payments"]); // cascades the relationship too
    builder.removeFromView(["Booking Engine"]);
    builder.createElement({ name: "New System", kind: "system" });

    bus.dispatch(builder.toBatch("mixed proposal")!);

    expect(ws.elements.has(payments.id)).toBe(false);
    expect(ws.relationships.size).toBe(0);
    expect(ws.view(view.id).placements.some((p) => p.elementId === booking.id)).toBe(false);
    expect([...ws.elements.values()].some((e) => e.name === "New System")).toBe(true);

    bus.undo();

    expect(ws.elements.size).toBe(beforeElementCount);
    expect(ws.relationships.size).toBe(beforeRelCount);
    expect(ws.elements.has(payments.id)).toBe(true);
    expect(ws.view(view.id).placements.some((p) => p.elementId === booking.id)).toBe(true);
    expect([...ws.elements.values()].some((e) => e.name === "New System")).toBe(false);
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

  it("lists stencil packs and per-element stencil ids", () => {
    const { ids, ws, bus, booking, view } = seed();
    ws.meta.stencilPacks = ["ai-agents@1"];
    bus.dispatch({
      type: "updateElement",
      id: booking.id,
      changes: { stencil: { pack: "ai-agents", stencil: "agent" } },
    });
    bus.dispatch({ type: "placeOnView", viewId: view.id, placement: { elementId: booking.id, x: 3, y: 4 } });
    const summary = buildModelSummary(ws);
    expect(summary).toContain("Stencil packs: ai-agents@1");
    expect(summary).toContain("(system, ai-agents/agent)");

    const detail = describeElement(ws, "Booking Engine")!;
    expect(detail).toContain("stencil: ai-agents/agent");
    expect(detail).toContain(`"${view.name}" @ (3,4)`);
    void ids;
  });
});

describe("ChangeSetBuilder — stencils", () => {
  it("validates a stencil ref and its attributes at planning time", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id, testRegistry());

    const agent = builder.createElement({
      name: "Support Agent",
      kind: "container",
      parent: "Booking Engine",
      stencil: { pack: "ai-agents", stencil: "agent", attributes: { runtime: "python" } },
    });
    expect(builder.clone.element(agent.id).stencil).toEqual({
      pack: "ai-agents",
      stencil: "agent",
      attributes: { runtime: "python" },
    });
  });

  it("rejects an unknown stencil id and invalid attributes before queuing", () => {
    const { ids, ws, view } = seed();
    const unknownStencil = new ChangeSetBuilder(ws, ids, view.id, testRegistry());
    expect(() =>
      unknownStencil.createElement({
        name: "Bad Agent",
        kind: "container",
        parent: "Booking Engine",
        stencil: { pack: "ai-agents", stencil: "nope" },
      }),
    ).toThrow(/Unknown stencil/);
    expect(unknownStencil.commands).toHaveLength(0);

    const badAttrs = new ChangeSetBuilder(ws, ids, view.id, testRegistry());
    expect(() =>
      badAttrs.createElement({
        name: "Bad Agent 2",
        kind: "container",
        parent: "Booking Engine",
        stencil: { pack: "ai-agents", stencil: "agent", attributes: { runtime: 42 } },
      }),
    ).toThrow();
    expect(badAttrs.commands).toHaveLength(0);
  });

  it("clears a stencil via update with null", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id, testRegistry());
    builder.createElement({
      name: "Support Agent",
      kind: "container",
      parent: "Booking Engine",
      stencil: { pack: "ai-agents", stencil: "agent" },
    });
    builder.updateElement("Support Agent", { stencil: null as never });
    expect(builder.clone.elements.get([...builder.clone.elements.values()].find((e) => e.name === "Support Agent")!.id)?.stencil).toBeUndefined();
  });
});

describe("ChangeSetBuilder — update_relationships", () => {
  it("resolves by source/target, disambiguating with name, and applies changes including null-clear", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.createRelationship({ source: "Booking Engine", target: "Payments", name: "charges via", technology: ["HTTP"] });
    builder.createRelationship({ source: "Booking Engine", target: "Payments", name: "refunds via" });

    expect(() =>
      builder.updateRelationship({ source: "Booking Engine", target: "Payments", new_name: "renamed" }),
    ).toThrow(ToolError);

    builder.updateRelationship({
      source: "Booking Engine",
      target: "Payments",
      name: "charges via",
      new_name: "authorises via",
      color: "#ff0000",
      technology: null,
    });
    const rel = [...builder.clone.relationships.values()].find((r) => r.name === "authorises via")!;
    expect(rel.color).toBe("#ff0000");
    expect(rel.technology).toBeUndefined();

    const stillThere = [...builder.clone.relationships.values()].find((r) => r.name === "refunds via");
    expect(stillThere).toBeTruthy();
  });

  it("errors with candidates when still ambiguous", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.createRelationship({ source: "Booking Engine", target: "Payments", name: "charges via" });
    builder.createRelationship({ source: "Booking Engine", target: "Payments", name: "refunds via" });
    try {
      builder.updateRelationship({ source: "Booking Engine", target: "Payments", new_name: "x" });
      throw new Error("expected updateRelationship to throw");
    } catch (err) {
      expect((err as Error).message).toContain("charges via");
      expect((err as Error).message).toContain("refunds via");
    }
  });
});

describe("ChangeSetBuilder — placement geometry", () => {
  it("places with explicit x/y/width/height and still accepts bare names", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.placeOnView([
      { name: "Booking Engine", x: 10, y: 20, width: 12, height: 6 },
      "Payments",
    ]);
    const bookingPlacement = builder.clone.view(view.id).placements.find((p) => p.elementId === builder.resolveElement("Booking Engine").id)!;
    expect(bookingPlacement).toMatchObject({ x: 10, y: 20, width: 12, height: 6 });
    const paymentsPlacement = builder.clone.view(view.id).placements.find((p) => p.elementId === builder.resolveElement("Payments").id)!;
    expect(paymentsPlacement.width).toBeUndefined();
  });

  it("moves an already-placed element via move_placement", () => {
    const { ids, ws, bus, view, booking } = seed();
    bus.dispatch({ type: "placeOnView", viewId: view.id, placement: { elementId: booking.id, x: 0, y: 0 } });

    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.movePlacement({ element: "Booking Engine", x: 5, y: 7, width: 9 });
    const placement = builder.clone.view(view.id).placements.find((p) => p.elementId === booking.id)!;
    expect(placement).toMatchObject({ x: 5, y: 7, width: 9 });

    bus.dispatch(builder.toBatch("move")!);
    expect(ws.view(view.id).placements.find((p) => p.elementId === booking.id)).toMatchObject({ x: 5, y: 7, width: 9 });
  });

  it("errors moving an element that is not on the view", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    expect(() => builder.movePlacement({ element: "Booking Engine", x: 1, y: 1 })).toThrow();
  });
});

describe("ChangeSetBuilder — state overrides", () => {
  it("merges overrides into an existing state entry and clears cleanly", () => {
    const { ids, ws, bus, view, booking } = seed();
    bus.dispatch({ type: "createState", state: { id: ids.next(), name: "Target", date: "2028-01-01" } });

    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.setStateOverride({ element: "Booking Engine", state: "Target", overrides: { name: "Booking (legacy)" } });
    builder.setStateOverride({ element: "Booking Engine", state: "Target", overrides: { status: "deprecated" } });
    bus.dispatch(builder.toBatch("overrides")!);

    const targetId = [...ws.states.values()].find((s) => s.name === "Target")!.id;
    expect(ws.element(booking.id).stateOverrides?.[targetId]).toEqual({
      name: "Booking (legacy)",
      status: "deprecated",
    });

    const clearer = new ChangeSetBuilder(ws, ids, view.id);
    clearer.setStateOverride({ element: "Booking Engine", state: "Target", clear: true });
    bus.dispatch(clearer.toBatch("clear override")!);
    expect(ws.element(booking.id).stateOverrides).toBeUndefined();
  });

  it("errors on an unknown state name", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    expect(() =>
      builder.setStateOverride({ element: "Booking Engine", state: "Nope", overrides: { name: "x" } }),
    ).toThrow(ToolError);
  });
});

describe("ChangeSetBuilder — get_tco", () => {
  it("matches core estateTco/elementAnnual for the whole estate and a single subtree", () => {
    const { ids, ws, bus, booking, payments, view } = seed();
    bus.dispatch({
      type: "updateElement",
      id: booking.id,
      changes: {
        costs: [
          { id: ids.next(), label: "Hosting", category: "infrastructure", classification: "run", kind: "recurring", amount: 12000 },
        ],
      },
    });
    bus.dispatch({
      type: "updateElement",
      id: payments.id,
      changes: {
        costs: [
          { id: ids.next(), label: "Licence", category: "licences", classification: "run", kind: "recurring", amount: 6000 },
        ],
      },
    });

    const builder = new ChangeSetBuilder(ws, ids, view.id);
    const report = builder.getTco({});
    const expected = estateTco(ws, { type: "all" }, 5);
    expect(report).toContain(`£${Math.round(expected.totalAnnual).toLocaleString("en-GB")}/yr`);
    expect(report).toContain(`£${Math.round(expected.totalTco).toLocaleString("en-GB")}`);

    const subtree = builder.getTco({ element: "Booking Engine", years: 3 });
    const expectedSubtree = elementAnnual(ws, booking.id, { type: "all" });
    expect(subtree).toContain(`£${Math.round(expectedSubtree.rolledUp).toLocaleString("en-GB")}/yr`);
    expect(subtree).toContain(`£${Math.round(expectedSubtree.rolledUp * 3).toLocaleString("en-GB")}`);
  });

  it("diffs two named states", () => {
    const { ids, ws, bus, booking, view } = seed();
    const currentId = ids.next();
    const targetId = ids.next();
    bus.dispatch({ type: "createState", state: { id: currentId, name: "Current" } });
    bus.dispatch({ type: "createState", state: { id: targetId, name: "Target" } });
    bus.dispatch({
      type: "updateElement",
      id: booking.id,
      changes: {
        costs: [
          {
            id: ids.next(),
            label: "Hosting",
            category: "infrastructure",
            classification: "run",
            kind: "recurring",
            amount: 10000,
            states: [targetId],
          },
        ],
      },
    });

    const builder = new ChangeSetBuilder(ws, ids, view.id);
    const report = builder.getTco({ compare_states: ["Current", "Target"] });
    expect(report).toContain("Current vs Target");
    expect(report).toContain("Delta");
  });

  it("queues nothing — read-only against the clone", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.getTco({});
    expect(builder.commands).toHaveLength(0);
    expect(builder.summary).toHaveLength(0);
  });
});

describe("ChangeSetBuilder — pin_route", () => {
  it("pins and clears a relationship's route on a view", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.createRelationship({ source: "Booking Engine", target: "Payments", name: "charges via" });
    builder.pinRoute({ source: "Booking Engine", target: "Payments", source_port: "r1", target_port: "l1" });

    const clonedView = builder.clone.view(view.id);
    const relId = [...builder.clone.relationships.values()].find((r) => r.name === "charges via")!.id;
    expect(clonedView.edgeAnchors?.[relId]).toEqual({ source: "r1", target: "l1" });

    builder.pinRoute({ source: "Booking Engine", target: "Payments", clear: true });
    expect(builder.clone.view(view.id).edgeAnchors?.[relId]).toBeUndefined();
  });

  it("rejects an invalid port", () => {
    const { ids, ws, view } = seed();
    const builder = new ChangeSetBuilder(ws, ids, view.id);
    builder.createRelationship({ source: "Booking Engine", target: "Payments" });
    expect(() =>
      builder.pinRoute({ source: "Booking Engine", target: "Payments", source_port: "z9", target_port: "l1" }),
    ).toThrow(ToolError);
  });
});
