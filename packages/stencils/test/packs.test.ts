import { describe, expect, it } from "vitest";
import { BUILTIN_PACKS, awsPack, builtinRegistry } from "../src/index.js";

describe("built-in stencil packs", () => {
  it("all packs register cleanly (unique ids, valid categories, compilable schemas)", () => {
    const registry = builtinRegistry();
    expect(registry.all()).toHaveLength(BUILTIN_PACKS.length);
  });

  it("cloud packs carry a starter set of ~40 stencils", () => {
    for (const id of ["aws", "azure", "gcp"]) {
      const pack = BUILTIN_PACKS.find((p) => p.id === id)!;
      expect(pack.stencils.length, id).toBeGreaterThanOrEqual(38);
    }
  });

  it("every stencil has both symbols and maps to a core kind", () => {
    for (const pack of BUILTIN_PACKS) {
      for (const s of pack.stencils) {
        expect(s.symbol2d, `${pack.id}/${s.id}`).toContain("<svg");
        expect(s.symbolIso, `${pack.id}/${s.id}`).toContain("<svg");
        expect(["person", "system", "container", "component", "group"]).toContain(s.elementType);
      }
    }
  });

  it("validates stencil attributes against the pack schema", () => {
    const registry = builtinRegistry();
    expect(
      registry.validateRef({ pack: "aws", stencil: "lambda", attributes: { accountId: "123456789012", region: "eu-west-2" } }),
    ).toEqual([]);
    const bad = registry.validateRef({ pack: "aws", stencil: "lambda", attributes: { accountId: "12" } });
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]).toContain("Lambda");
  });

  it("unknown stencils in a known pack are an error; unknown packs are tolerated", () => {
    const registry = builtinRegistry();
    expect(registry.validateRef({ pack: "aws", stencil: "nope" })).toHaveLength(1);
    expect(registry.validateRef({ pack: "not-installed", stencil: "x" })).toEqual([]);
  });

  it("aws pack exposes VPC as a group boundary", () => {
    const vpc = awsPack.stencils.find((s) => s.id === "vpc")!;
    expect(vpc.elementType).toBe("group");
    expect(vpc.attributeSchema).toBeUndefined();
  });
});
