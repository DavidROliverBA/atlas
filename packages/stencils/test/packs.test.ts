import { describe, expect, it } from "vitest";
import { BUILTIN_PACKS, aiAgentsPack, awsPack, builtinRegistry } from "../src/index.js";

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

  it("cloud service stencils map to components (inside containers), never containers", () => {
    for (const pack of BUILTIN_PACKS.filter((p) => ["aws", "azure", "gcp"].includes(p.id))) {
      for (const s of pack.stencils) {
        expect(["component", "group"], `${pack.id}/${s.id}`).toContain(s.elementType);
      }
    }
  });
});

describe("ai-agents pack", () => {
  it("registers cleanly and carries 14 stencils", () => {
    const registry = builtinRegistry();
    expect(registry.pack("ai-agents")).toBeDefined();
    expect(aiAgentsPack.stencils).toHaveLength(14);
  });

  it("splits into containers, components and a single group boundary — never a new kind", () => {
    const byKind = { container: 0, component: 0, group: 0 } as Record<string, number>;
    for (const s of aiAgentsPack.stencils) {
      expect(["container", "component", "group"], s.id).toContain(s.elementType);
      byKind[s.elementType] = (byKind[s.elementType] ?? 0) + 1;
    }
    expect(byKind.container).toBe(6); // agent, orchestrator-agent, agent-runtime, model-gateway, mcp-server, sandbox
    expect(byKind.component).toBe(7); // vector-memory, episodic-memory, guardrail, evaluator, human-approval-gate, tool, prompt-template
    expect(byKind.group).toBe(1); // agent-swarm
  });

  it("names the containers and components exactly as specced", () => {
    const idsOf = (kind: "container" | "component") =>
      aiAgentsPack.stencils.filter((s) => s.elementType === kind).map((s) => s.id).sort();
    expect(idsOf("container")).toEqual(
      ["agent", "agent-runtime", "mcp-server", "model-gateway", "orchestrator-agent", "sandbox"].sort(),
    );
    expect(idsOf("component")).toEqual(
      ["episodic-memory", "evaluator", "guardrail", "human-approval-gate", "prompt-template", "tool", "vector-memory"].sort(),
    );
  });

  it("agent-swarm is a group boundary with no attribute schema, like every other group stencil", () => {
    const swarm = aiAgentsPack.stencils.find((s) => s.id === "agent-swarm")!;
    expect(swarm.elementType).toBe("group");
    expect(swarm.attributeSchema).toBeUndefined();
  });

  it("every non-group stencil carries its own attribute schema (per-stencil, not pack-uniform)", () => {
    for (const s of aiAgentsPack.stencils) {
      if (s.elementType === "group") continue;
      expect(s.attributeSchema, s.id).toBeDefined();
    }
  });

  it("every stencil has both symbols and the pack's indigo glyph colour", () => {
    for (const s of aiAgentsPack.stencils) {
      expect(s.symbol2d, s.id).toContain("<svg");
      expect(s.symbol2d, s.id).toContain("#4f46e5");
      expect(s.symbolIso, s.id).toContain("<svg");
    }
  });

  // A good and a bad attribute set per stencil, exercising every schema
  // through the same registry.validateRef() path the command bus uses.
  const cases: Array<{ id: string; good: Record<string, unknown>; bad: Record<string, unknown> }> = [
    {
      id: "agent",
      good: {
        model: "claude-opus-4-6",
        provider: "anthropic",
        role: "sub-agent",
        autonomyLevel: "approve",
        contextStrategy: "rag",
        goal: "Triage inbound support tickets",
        dataAccessScope: "read:tickets, write:ticket-notes",
        evaluationApproach: "LLM-as-judge weekly + golden-set regression",
      },
      bad: { autonomyLevel: "yolo" },
    },
    {
      id: "orchestrator-agent",
      good: { model: "claude-opus-4-6", provider: "anthropic", coordinationPattern: "supervisor", autonomyLevel: "approve" },
      bad: { coordinationPattern: "free-for-all" },
    },
    {
      id: "agent-runtime",
      good: { framework: "LangGraph", hostingModel: "kubernetes", concurrencyModel: "pooled", stateBackend: "Redis" },
      bad: { hostingModel: "bare-metal" },
    },
    {
      id: "model-gateway",
      good: { providers: ["anthropic", "openai"], routingStrategy: "fallback-chain", caching: true, rateLimiting: false },
      bad: { routingStrategy: "vibes-based" },
    },
    {
      id: "mcp-server",
      good: { transport: "streamable-http", primitivesExposed: ["tools", "resources"], authModel: "oauth" },
      bad: { transport: "http/1.1" },
    },
    {
      id: "sandbox",
      good: { isolation: "microvm", language: "python", networkAccess: "allowlist", timeoutSeconds: 30 },
      bad: { isolation: "docker-compose" },
    },
    {
      id: "vector-memory",
      good: { embeddingModel: "text-embedding-4", dimensions: 1536, retrievalStrategy: "hybrid-keyword-vector", freshness: "batch-refresh" },
      bad: { retrievalStrategy: "vibes" },
    },
    {
      id: "episodic-memory",
      good: { retentionWindow: "30 days", storageForm: "structured-events", scope: "per-session" },
      bad: { scope: "global" },
    },
    {
      id: "guardrail",
      good: { guardrailType: "policy-engine", enforcement: "block", vendor: "custom rules" },
      bad: { enforcement: "ignore" },
    },
    {
      id: "evaluator",
      good: { method: "llm-as-judge", cadence: "per-request", metric: "faithfulness, toxicity" },
      bad: { method: "vibes" },
    },
    {
      id: "human-approval-gate",
      good: { triggerCondition: "refunds over £100", slaMinutes: 15, fallback: "block" },
      bad: { fallback: "ignore" },
    },
    {
      id: "tool",
      good: { protocol: "mcp", sideEffects: "read-only", authScope: "read:calendar", rateLimit: "10/min" },
      bad: { sideEffects: "whatever" },
    },
    {
      id: "prompt-template",
      good: { templateType: "system-prompt", version: "1.0", variables: ["name", "date"] },
      bad: { templateType: "freeform" },
    },
  ];

  for (const { id, good, bad } of cases) {
    it(`${id}: attribute schema compiles and validates a good/bad attribute set`, () => {
      const registry = builtinRegistry();
      expect(registry.validateRef({ pack: "ai-agents", stencil: id, attributes: good })).toEqual([]);
      const badResult = registry.validateRef({ pack: "ai-agents", stencil: id, attributes: bad });
      expect(badResult.length, `${id} should reject ${JSON.stringify(bad)}`).toBeGreaterThan(0);
    });
  }

  it("rejects unknown attributes (additionalProperties: false) the same way as a bad enum", () => {
    const registry = builtinRegistry();
    const result = registry.validateRef({ pack: "ai-agents", stencil: "agent", attributes: { notAField: "x" } });
    expect(result.length).toBeGreaterThan(0);
  });
});
