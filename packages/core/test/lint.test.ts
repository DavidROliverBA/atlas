import { describe, expect, it } from "vitest";
import { buildFixture } from "./fixture.js";
import { lintWorkspace, type LintIssue } from "../src/analysis/graph.js";
import type { Element } from "../src/metamodel/types.js";

function issuesOf(issues: LintIssue[], code: LintIssue["code"], id: string): LintIssue[] {
  return issues.filter((i) => i.code === code && i.ids.includes(id));
}

describe("lintWorkspace: severity", () => {
  it("classifies the structural rules sensibly (errors reserved for correctness breaks)", () => {
    const f = buildFixture();
    // Create an orphan (not on any view) and a duplicate name to exercise both structural rules.
    f.bus.dispatch({
      type: "createElement",
      element: { id: f.ids.next(), kind: "system", name: "Orphaned Thing", parentId: null },
    });
    f.bus.dispatch({
      type: "createElement",
      element: { id: f.ids.next(), kind: "container", name: "Web App", parentId: f.booking.id },
    });
    const issues = lintWorkspace(f.ws);

    const orphan = issues.find((i) => i.code === "orphan-element" && i.message.includes("Orphaned Thing"))!;
    expect(orphan.severity).toBe("warning");
    const dup = issues.find((i) => i.code === "duplicate-name")!;
    expect(dup.severity).toBe("warning");
    // No rule currently rises to "error" — none of the structural checks break correctness outright.
    expect(issues.every((i) => i.severity !== "error")).toBe(true);
  });

  it("classifies unplaced-relationship as info", () => {
    const f = buildFixture();
    // legacyRel is placed on the landscape view (both Booking Engine and Mainframe are there), so
    // it is already shown; hide it explicitly to make it "unplaced" per the rule's own definition.
    f.bus.dispatch({
      type: "updateView",
      id: f.landscape.id,
      changes: { hiddenRelationshipIds: [f.legacyRel.id] },
    });
    const issues = lintWorkspace(f.ws);
    const issue = issues.find((i) => i.code === "unplaced-relationship" && i.ids.includes(f.legacyRel.id))!;
    expect(issue).toBeDefined();
    expect(issue.severity).toBe("info");
  });
});

describe("lintWorkspace: unowned-critical", () => {
  it("flags a high/critical element with no owners and no team", () => {
    const f = buildFixture();
    f.bus.dispatch({ type: "updateElement", id: f.payments.id, changes: { criticality: "high" } });
    const issues = lintWorkspace(f.ws);
    const issue = issues.find((i) => i.code === "unowned-critical" && i.ids.includes(f.payments.id));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
  });

  it("does not flag a critical element that has owners (negative case)", () => {
    const f = buildFixture();
    // Booking Engine is already criticality: "critical" with owners: ["Commercial IT"].
    const issues = lintWorkspace(f.ws);
    expect(issuesOf(issues, "unowned-critical", f.booking.id)).toEqual([]);
  });

  it("does not flag a critical element owned only via `team` (negative case)", () => {
    const f = buildFixture();
    f.bus.dispatch({
      type: "updateElement",
      id: f.payments.id,
      changes: { criticality: "critical", team: "Payments Platform" },
    });
    const issues = lintWorkspace(f.ws);
    expect(issuesOf(issues, "unowned-critical", f.payments.id)).toEqual([]);
  });
});

describe("lintWorkspace: agent-without-guardrail", () => {
  it("flags an ai-agents agent with no relationship to any oversight element", () => {
    const f = buildFixture();
    const agent: Element = {
      id: f.ids.next(),
      kind: "container",
      name: "Refund Agent",
      parentId: f.booking.id,
      stencil: { pack: "ai-agents", stencil: "agent" },
    };
    f.bus.dispatch({ type: "createElement", element: agent });

    const issues = lintWorkspace(f.ws);
    const issue = issues.find((i) => i.code === "agent-without-guardrail" && i.ids.includes(agent.id));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
  });

  it("does not flag an orchestrator-agent with a relationship to a human-approval-gate (negative case)", () => {
    const f = buildFixture();
    const orchestrator: Element = {
      id: f.ids.next(),
      kind: "container",
      name: "Claims Orchestrator",
      parentId: f.booking.id,
      stencil: { pack: "ai-agents", stencil: "orchestrator-agent" },
    };
    const gate: Element = {
      id: f.ids.next(),
      kind: "component",
      name: "Payout Approval",
      parentId: orchestrator.id,
      stencil: { pack: "ai-agents", stencil: "human-approval-gate" },
    };
    f.bus.dispatch({ type: "createElement", element: orchestrator });
    f.bus.dispatch({ type: "createElement", element: gate });
    // Direction shouldn't matter: the gate points at the orchestrator here.
    f.bus.dispatch({
      type: "createRelationship",
      relationship: { id: f.ids.next(), sourceId: gate.id, targetId: orchestrator.id, name: "gates" },
    });

    const issues = lintWorkspace(f.ws);
    expect(issuesOf(issues, "agent-without-guardrail", orchestrator.id)).toEqual([]);
  });

  it("does not flag non-agent stencils or plain elements (negative case)", () => {
    const f = buildFixture();
    const tool: Element = {
      id: f.ids.next(),
      kind: "component",
      name: "Ticket Lookup Tool",
      parentId: f.webApp.id,
      stencil: { pack: "ai-agents", stencil: "tool" },
    };
    f.bus.dispatch({ type: "createElement", element: tool });
    const issues = lintWorkspace(f.ws);
    expect(issues.some((i) => i.code === "agent-without-guardrail" && i.ids.includes(tool.id))).toBe(false);
    // Ordinary elements without any stencil are never candidates either.
    expect(issuesOf(issues, "agent-without-guardrail", f.booking.id)).toEqual([]);
  });
});

describe("lintWorkspace: estimate-cost-on-live", () => {
  it("flags a live element carrying a cost with no confidence (defaults to estimate)", () => {
    const f = buildFixture();
    f.bus.dispatch({
      type: "updateElement",
      id: f.payments.id, // status: "live" in the fixture
      changes: {
        costs: [
          {
            id: f.ids.next(),
            label: "Guess at hosting",
            category: "infrastructure",
            classification: "run",
            kind: "recurring",
            amount: 1000,
          },
        ],
      },
    });
    const issues = lintWorkspace(f.ws);
    const issue = issues.find((i) => i.code === "estimate-cost-on-live" && i.ids.includes(f.payments.id));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("info");
  });

  it("does not flag a live element whose costs are all quoted/actual (negative case)", () => {
    const f = buildFixture();
    f.bus.dispatch({
      type: "updateElement",
      id: f.payments.id,
      changes: {
        costs: [
          {
            id: f.ids.next(),
            label: "Signed contract",
            category: "vendor-services",
            classification: "run",
            kind: "recurring",
            amount: 5000,
            confidence: "actual",
          },
        ],
      },
    });
    const issues = lintWorkspace(f.ws);
    expect(issuesOf(issues, "estimate-cost-on-live", f.payments.id)).toEqual([]);
  });

  it("does not flag an estimate cost on a non-live element (negative case)", () => {
    const f = buildFixture();
    // Legacy Mainframe is status: "deprecated" in the fixture.
    f.bus.dispatch({
      type: "updateElement",
      id: f.mainframe.id,
      changes: {
        costs: [
          {
            id: f.ids.next(),
            label: "Rough estimate",
            category: "infrastructure",
            classification: "run",
            kind: "recurring",
            amount: 1000,
          },
        ],
      },
    });
    const issues = lintWorkspace(f.ws);
    expect(issuesOf(issues, "estimate-cost-on-live", f.mainframe.id)).toEqual([]);
  });
});

describe("lintWorkspace: undocumented-system", () => {
  it("flags a system with neither description nor documentation", () => {
    const f = buildFixture();
    // Payments (a system) has no description and no documentation in the fixture.
    const issues = lintWorkspace(f.ws);
    const issue = issues.find((i) => i.code === "undocumented-system" && i.ids.includes(f.payments.id));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("info");
  });

  it("does not flag a system that has a description (negative case)", () => {
    const f = buildFixture();
    // Booking Engine has a description in the fixture ("Reservations and ticketing").
    const issues = lintWorkspace(f.ws);
    expect(issuesOf(issues, "undocumented-system", f.booking.id)).toEqual([]);
  });

  it("does not flag a container/person with no description — the rule is systems-only (negative case)", () => {
    const f = buildFixture();
    // Web App (a container) has no description in the fixture either.
    const issues = lintWorkspace(f.ws);
    expect(issuesOf(issues, "undocumented-system", f.webApp.id)).toEqual([]);
  });
});
