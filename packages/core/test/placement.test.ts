import { describe, expect, it } from "vitest";
import { buildFixture } from "./fixture.js";
import { ModelRuleError, VIEW_PLACEMENT } from "../src/metamodel/rules.js";

describe("view-level placement rules", () => {
  it("people belong to context-level views only", () => {
    expect(VIEW_PLACEMENT.landscape).toContain("person");
    expect(VIEW_PLACEMENT.context).toContain("person");
    expect(VIEW_PLACEMENT.container).not.toContain("person");
    expect(VIEW_PLACEMENT.component).not.toContain("person");
    expect(VIEW_PLACEMENT.custom).not.toContain("person");
  });

  it("components (incl. all cloud stencils) belong to component views only", () => {
    for (const kind of ["landscape", "context", "container", "custom"] as const) {
      expect(VIEW_PLACEMENT[kind]).not.toContain("component");
    }
    expect(VIEW_PLACEMENT.component).toContain("component");
  });

  it("rejects placing a person on a container view with a level-aware message", () => {
    const f = buildFixture();
    expect(() =>
      f.bus.dispatch({
        type: "placeOnView",
        viewId: f.containerView.id,
        placement: { elementId: f.customer.id, x: 0, y: 0 },
      }),
    ).toThrow(/Person cannot appear on a container view.*landscape, system context/);
  });

  it("rejects creating a view whose initial placements break the level rules", () => {
    const f = buildFixture();
    expect(() =>
      f.bus.dispatch({
        type: "createView",
        view: {
          id: f.ids.next(),
          kind: "component",
          name: "Bad",
          scopeId: f.webApp.id,
          placements: [{ elementId: f.customer.id, x: 0, y: 0 }],
        },
      }),
    ).toThrow(ModelRuleError);
  });

  it("groups are placeable on every view kind", () => {
    for (const kinds of Object.values(VIEW_PLACEMENT)) {
      expect(kinds).toContain("group");
    }
  });
});
