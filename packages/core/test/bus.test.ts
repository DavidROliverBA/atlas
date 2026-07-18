import { describe, expect, it } from "vitest";
import { buildFixture } from "./fixture.js";
import { ModelRuleError } from "../src/metamodel/rules.js";
import type { Element } from "../src/metamodel/types.js";

describe("command bus", () => {
  it("creates and reads back model objects", () => {
    const f = buildFixture();
    expect(f.ws.elements.size).toBe(6);
    expect(f.ws.relationships.size).toBe(3);
    expect(f.ws.element(f.webApp.id).parentId).toBe(f.booking.id);
  });

  it("rejects illegal containment", () => {
    const f = buildFixture();
    const bad: Element = {
      id: f.ids.next(),
      kind: "component",
      name: "Rogue component",
      parentId: f.booking.id, // component directly inside a system — illegal
    };
    expect(() => f.bus.dispatch({ type: "createElement", element: bad })).toThrow(ModelRuleError);
    expect(f.ws.elements.size).toBe(6);
  });

  it("allows containment resolved through groups", () => {
    const f = buildFixture();
    const groupId = f.ids.next();
    f.bus.dispatch({
      type: "createElement",
      element: { id: groupId, kind: "group", name: "Front-end", parentId: f.booking.id },
    });
    // A container inside a group inside a system is legal (group is transparent).
    f.bus.dispatch({
      type: "createElement",
      element: { id: f.ids.next(), kind: "container", name: "Mobile App", parentId: groupId },
    });
    expect(f.ws.children(groupId)).toHaveLength(1);
  });

  it("rejects relationships to groups and unknown endpoints", () => {
    const f = buildFixture();
    const groupId = f.ids.next();
    f.bus.dispatch({
      type: "createElement",
      element: { id: groupId, kind: "group", name: "Zone", parentId: null },
    });
    expect(() =>
      f.bus.dispatch({
        type: "createRelationship",
        relationship: { id: f.ids.next(), sourceId: f.booking.id, targetId: groupId },
      }),
    ).toThrow(/boundaries/);
    expect(() =>
      f.bus.dispatch({
        type: "createRelationship",
        relationship: { id: f.ids.next(), sourceId: f.booking.id, targetId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      }),
    ).toThrow(/does not exist/);
  });

  it("undo/redo restores exact state, including cascades", () => {
    const f = buildFixture();
    const before = JSON.stringify(f.ws.toData());

    // Delete a system that has relationships and placements: cascades.
    f.bus.dispatch({ type: "deleteElement", id: f.mainframe.id });
    expect(f.ws.elements.has(f.mainframe.id)).toBe(false);
    expect(f.ws.relationships.has(f.legacyRel.id)).toBe(false);
    expect(
      f.ws.view(f.landscape.id).placements.some((p) => p.elementId === f.mainframe.id),
    ).toBe(false);

    expect(f.bus.undo()).toBe(true);
    expect(JSON.stringify(f.ws.toData())).toBe(before);

    expect(f.bus.redo()).toBe(true);
    expect(f.ws.elements.has(f.mainframe.id)).toBe(false);
    expect(f.bus.undo()).toBe(true);
    expect(JSON.stringify(f.ws.toData())).toBe(before);
  });

  it("update inverse restores removed optional properties", () => {
    const f = buildFixture();
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { description: null as never } });
    expect(f.ws.element(f.booking.id).description).toBeUndefined();
    f.bus.undo();
    expect(f.ws.element(f.booking.id).description).toBe("Reservations and ticketing");
  });

  it("refuses to delete an element with children", () => {
    const f = buildFixture();
    expect(() => f.bus.dispatch({ type: "deleteElement", id: f.booking.id })).toThrow(/contains/);
  });

  it("prevents containment cycles on move", () => {
    const f = buildFixture();
    const groupId = f.ids.next();
    f.bus.dispatch({
      type: "createElement",
      element: { id: groupId, kind: "group", name: "Zone", parentId: f.booking.id },
    });
    expect(() =>
      f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { parentId: groupId } }),
    ).toThrow(/descendant/);
  });

  it("batch commands are atomic and undo as one step", () => {
    const f = buildFixture();
    const before = JSON.stringify(f.ws.toData());
    const okId = f.ids.next();

    // Second command fails → the whole batch must roll back.
    expect(() =>
      f.bus.dispatch({
        type: "batch",
        commands: [
          { type: "createElement", element: { id: okId, kind: "system", name: "New", parentId: null } },
          { type: "createElement", element: { id: okId, kind: "system", name: "Dup id", parentId: null } },
        ],
      }),
    ).toThrow(/already exists/);
    expect(JSON.stringify(f.ws.toData())).toBe(before);

    // A valid batch applies fully and undoes in one step.
    const a = f.ids.next();
    const b = f.ids.next();
    f.bus.dispatch({
      type: "batch",
      label: "Add CRM and integrate",
      commands: [
        { type: "createElement", element: { id: a, kind: "system", name: "CRM", parentId: null } },
        { type: "createRelationship", relationship: { id: b, sourceId: f.booking.id, targetId: a } },
      ],
    });
    expect(f.ws.elements.has(a)).toBe(true);
    f.bus.undo();
    expect(JSON.stringify(f.ws.toData())).toBe(before);
  });

  it("deleting a state scrubs memberships and overrides, undo restores them", () => {
    const f = buildFixture();
    f.bus.dispatch({
      type: "updateElement",
      id: f.mainframe.id,
      changes: { temporal: { validTo: "2027-12-31", states: [f.current.id] } },
    });
    const before = JSON.stringify(f.ws.toData());

    f.bus.dispatch({ type: "deleteState", id: f.current.id });
    expect(f.ws.states.has(f.current.id)).toBe(false);
    expect(f.ws.element(f.mainframe.id).temporal?.states).toBeUndefined();

    f.bus.undo();
    expect(JSON.stringify(f.ws.toData())).toBe(before);
  });

  it("dispatch clears the redo stack", () => {
    const f = buildFixture();
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { team: "Team Nova" } });
    f.bus.undo();
    expect(f.bus.canRedo).toBe(true);
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { team: "Team Vega" } });
    expect(f.bus.canRedo).toBe(false);
  });
});
