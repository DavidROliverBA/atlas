import { describe, expect, it } from "vitest";
import { importArchimate } from "../src/interop/archimate.js";
import { seededUlidFactory } from "../src/ids.js";
import { checkIntegrity } from "../src/serialize/files.js";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       identifier="id-model">
  <name xml:lang="en">Insurance Model</name>
  <elements>
    <element identifier="id-1" xsi:type="BusinessActor"><name xml:lang="en">Claims Adjuster</name></element>
    <element identifier="id-2" xsi:type="ApplicationComponent">
      <name xml:lang="en">Claims System</name>
      <documentation xml:lang="en">Handles claims end to end</documentation>
    </element>
    <element identifier="id-3" xsi:type="ApplicationComponent"><name xml:lang="en">Policy System</name></element>
    <element identifier="id-4" xsi:type="BusinessProcess"><name xml:lang="en">Handle Claim</name></element>
  </elements>
  <relationships>
    <relationship identifier="id-r1" xsi:type="Serving" source="id-3" target="id-2"/>
    <relationship identifier="id-r2" xsi:type="Assignment" source="id-1" target="id-2"/>
    <relationship identifier="id-r3" xsi:type="Triggering" source="id-4" target="id-2"/>
  </relationships>
</model>`;

describe("ArchiMate Open Exchange import (best effort)", () => {
  it("maps business/application layer elements and tags relationships by type", () => {
    const { workspace, warnings } = importArchimate(SAMPLE, seededUlidFactory(6));

    expect(workspace.meta.name).toBe("Insurance Model");
    const names = [...workspace.elements.values()].map((e) => `${e.kind}:${e.name}`).sort();
    expect(names).toEqual([
      "person:Claims Adjuster",
      "system:Claims System",
      "system:Policy System",
    ]);
    const claims = [...workspace.elements.values()].find((e) => e.name === "Claims System")!;
    expect(claims.description).toBe("Handles claims end to end");
    expect(claims.tags).toContain("archimate:applicationcomponent");

    // Serving + Assignment import; Triggering is dropped with its unmapped endpoint.
    expect(workspace.relationships.size).toBe(2);
    const rels = [...workspace.relationships.values()];
    expect(rels.some((r) => r.tags?.includes("archimate:serving"))).toBe(true);

    expect(warnings.join("\n")).toContain("BusinessProcess");
    expect(warnings.join("\n")).toContain("endpoint not imported");
    checkIntegrity(workspace);
  });

  it("rejects non-ArchiMate XML with a clear error", () => {
    expect(() => importArchimate("<html></html>", seededUlidFactory(7))).toThrow(/Open Exchange/);
  });
});
