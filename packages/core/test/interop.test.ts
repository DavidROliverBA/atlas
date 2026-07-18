import { describe, expect, it } from "vitest";
import { buildFixture } from "./fixture.js";
import { toSvg } from "../src/export/svg.js";
import { toMermaidC4, toPlantUmlC4 } from "../src/export/text.js";
import { importStructurizr } from "../src/interop/structurizr.js";
import { seededUlidFactory } from "../src/ids.js";
import { checkIntegrity } from "../src/serialize/files.js";

describe("view exports", () => {
  it("renders a deterministic standalone SVG", () => {
    const f = buildFixture();
    const svg = toSvg(f.ws, f.landscape.id);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Booking Engine");
    expect(svg).toContain("books trips with");
    expect(toSvg(f.ws, f.landscape.id)).toBe(svg); // deterministic
  });

  it("emits Mermaid and PlantUML C4", () => {
    const f = buildFixture();
    expect(toMermaidC4(f.ws, f.landscape.id)).toContain("C4Context");
    expect(toPlantUmlC4(f.ws, f.containerView.id)).toContain("C4_Container.puml");
  });
});

describe("Structurizr import (best effort)", () => {
  const sample = {
    name: "Big Bank plc",
    model: {
      people: [
        {
          id: "1",
          name: "Personal Banking Customer",
          description: "A customer of the bank",
          tags: "Element,Person",
          relationships: [
            { sourceId: "1", destinationId: "2", description: "Views balances using" },
          ],
        },
      ],
      softwareSystems: [
        {
          id: "2",
          name: "Internet Banking System",
          technology: "",
          containers: [
            {
              id: "3",
              name: "Web Application",
              technology: "Java, Spring MVC",
              components: [{ id: "4", name: "Sign In Controller", technology: "Spring MVC" }],
              relationships: [{ sourceId: "3", destinationId: "5", description: "Reads from", technology: "JDBC" }],
            },
            { id: "5", name: "Database", technology: "Oracle" },
          ],
        },
      ],
    },
  };

  it("maps people/systems/containers/components with hierarchy and relationships", () => {
    const { workspace, warnings } = importStructurizr(sample, seededUlidFactory(4));
    expect(warnings).toEqual([]);
    expect(workspace.elements.size).toBe(5);
    expect(workspace.relationships.size).toBe(2);

    const webApp = [...workspace.elements.values()].find((e) => e.name === "Web Application")!;
    expect(webApp.kind).toBe("container");
    expect(webApp.technology).toEqual(["Java", "Spring MVC"]);
    const controller = [...workspace.elements.values()].find((e) => e.name === "Sign In Controller")!;
    expect(controller.parentId).toBe(webApp.id);

    // Auto landscape places top-level elements only.
    const landscape = [...workspace.views.values()][0]!;
    expect(landscape.placements).toHaveLength(2);
    checkIntegrity(workspace);
  });

  it("collects warnings instead of failing on dangling relationships", () => {
    const { warnings, workspace } = importStructurizr(
      {
        model: {
          people: [
            {
              id: "1",
              name: "User",
              relationships: [{ sourceId: "1", destinationId: "99", description: "uses" }],
            },
          ],
        },
      },
      seededUlidFactory(5),
    );
    expect(workspace.elements.size).toBe(1);
    expect(warnings.join("\n")).toContain("endpoint not imported");
  });
});
