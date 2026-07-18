import { describe, expect, it } from "vitest";
import { buildFixture } from "./fixture.js";
import {
  diffContexts,
  diffReport,
  effectiveElement,
  visibleElements,
  visibleRelationships,
} from "../src/temporal/engine.js";
import { egoNetwork, downstreamOf, lintWorkspace } from "../src/analysis/graph.js";

describe("temporal engine", () => {
  it("date context hides retired elements and their relationships", () => {
    const f = buildFixture();
    const in2026 = visibleElements(f.ws, { type: "date", date: "2026-07-18" });
    expect(in2026.has(f.mainframe.id)).toBe(true);

    const in2028 = visibleElements(f.ws, { type: "date", date: "2028-06-01" });
    expect(in2028.has(f.mainframe.id)).toBe(false);
    expect(in2028.has(f.booking.id)).toBe(true);

    const rels2028 = visibleRelationships(f.ws, { type: "date", date: "2028-06-01" });
    expect(rels2028.has(f.legacyRel.id)).toBe(false);
    expect(rels2028.has(f.paysRel.id)).toBe(true);
  });

  it("hidden ancestors hide their descendants", () => {
    const f = buildFixture();
    f.bus.dispatch({
      type: "updateElement",
      id: f.booking.id,
      changes: { temporal: { validTo: "2027-01-01" } },
    });
    const in2028 = visibleElements(f.ws, { type: "date", date: "2028-06-01" });
    expect(in2028.has(f.booking.id)).toBe(false);
    expect(in2028.has(f.webApp.id)).toBe(false);
  });

  it("state contexts use explicit membership when present, else the anchor date", () => {
    const f = buildFixture();
    // Target 2028 is dated 2028-01-01, after the mainframe's validTo.
    const target = visibleElements(f.ws, { type: "state", stateId: f.target.id });
    expect(target.has(f.mainframe.id)).toBe(false);

    // Explicit membership overrides dates: pin the mainframe into the target state.
    f.bus.dispatch({
      type: "updateElement",
      id: f.mainframe.id,
      changes: { temporal: { validTo: "2027-12-31", states: [f.target.id] } },
    });
    const pinned = visibleElements(f.ws, { type: "state", stateId: f.target.id });
    expect(pinned.has(f.mainframe.id)).toBe(true);
    // ...and excludes it from states it is not a member of.
    const current = visibleElements(f.ws, { type: "state", stateId: f.current.id });
    expect(current.has(f.mainframe.id)).toBe(false);
  });

  it("applies per-state attribute overrides", () => {
    const f = buildFixture();
    const el = f.ws.element(f.webApp.id);
    expect(effectiveElement(el, { type: "state", stateId: f.current.id }).technology).toEqual([
      "TypeScript",
      "React",
    ]);
    expect(effectiveElement(el, { type: "state", stateId: f.target.id }).technology).toEqual([
      "TypeScript",
      "Next.js",
    ]);
  });

  it("diffs two states into added/removed/changed plus a readable report", () => {
    const f = buildFixture();
    const diff = diffContexts(
      f.ws,
      { type: "state", stateId: f.current.id },
      { type: "state", stateId: f.target.id },
    );
    expect(diff.removedElements).toContain(f.mainframe.id);
    expect(diff.changedElements.map((c) => c.id)).toContain(f.webApp.id);
    expect(diff.removedRelationships).toContain(f.legacyRel.id);

    const report = diffReport(f.ws, diff);
    expect(report).toContain("- Legacy Mainframe");
    expect(report).toContain("~ Web App: technology");
  });
});

describe("graph analysis", () => {
  it("builds an ego network with depth and direction filters", () => {
    const f = buildFixture();
    const oneHop = egoNetwork(f.ws, f.booking.id, { depth: 1 });
    expect(new Set(oneHop.elements.keys())).toEqual(
      new Set([f.booking.id, f.customer.id, f.payments.id, f.mainframe.id]),
    );

    const outbound = egoNetwork(f.ws, f.booking.id, { depth: 1, direction: "out" });
    expect(outbound.elements.has(f.customer.id)).toBe(false);

    const legacyOnly = egoNetwork(f.ws, f.booking.id, { depth: 1, tags: ["legacy"] });
    expect(new Set(legacyOnly.elements.keys())).toEqual(new Set([f.booking.id, f.mainframe.id]));
  });

  it("computes downstream impact", () => {
    const f = buildFixture();
    expect(downstreamOf(f.ws, f.customer.id)).toEqual(
      new Set([f.booking.id, f.payments.id, f.mainframe.id]),
    );
  });

  it("lints orphans and duplicate names", () => {
    const f = buildFixture();
    f.bus.dispatch({
      type: "createElement",
      element: { id: f.ids.next(), kind: "system", name: "Orphaned Thing", parentId: null },
    });
    f.bus.dispatch({
      type: "createElement",
      element: { id: f.ids.next(), kind: "container", name: "Web App", parentId: f.booking.id },
    });
    const issues = lintWorkspace(f.ws);
    expect(issues.some((i) => i.code === "orphan-element" && i.message.includes("Orphaned Thing"))).toBe(true);
    expect(issues.some((i) => i.code === "duplicate-name" && i.message.includes("web app"))).toBe(true);
  });
});
