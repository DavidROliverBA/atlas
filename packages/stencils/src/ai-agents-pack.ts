/**
 * AI Agents pack (docs/research-ai-agents.md): agents, orchestration, tools,
 * memory, guardrails and human oversight for agentic-AI systems.
 *
 * Hand-authored against the raw `Stencil`/`StencilPack` interfaces rather
 * than `definePack()` — that helper applies one `attributeSchema` for the
 * whole pack (every existing pack either has none or shares one uniform
 * schema across all stencils), but this pack needs a distinct schema per
 * stencil (an agent's schema looks nothing like a guardrail's). Still reuses
 * `symbol2d`/`symbolIso` so the glyph look matches every other pack.
 */

import type { Stencil, StencilPack } from "@atlas/core";
import { symbol2d, symbolIso } from "./lib.js";

const COLOR = "#4f46e5"; // indigo-600 — distinct from every other built-in pack hue.

const PROVIDER_ENUM = [
  "anthropic",
  "openai",
  "google",
  "azure-openai",
  "aws-bedrock",
  "mistral",
  "meta",
  "self-hosted",
  "other",
];

const AUTONOMY_ENUM = ["suggest", "approve", "act", "full-auto"];
const CONTEXT_STRATEGY_ENUM = ["stateless", "short-term-window", "rag", "long-term-memory", "hybrid"];

function stencil(
  id: string,
  name: string,
  category: string,
  elementType: Stencil["elementType"],
  abbrev: string,
  attributeSchema?: Record<string, unknown>,
): Stencil {
  return {
    id,
    name,
    category,
    elementType,
    symbol2d: symbol2d(abbrev, COLOR),
    symbolIso: symbolIso(abbrev, COLOR),
    ...(attributeSchema ? { attributeSchema } : {}),
  };
}

export const aiAgentsPack: StencilPack = {
  formatVersion: 1,
  id: "ai-agents",
  name: "AI Agents",
  version: "1.0.0",
  description: "Agents, orchestration, tools, memory, guardrails and human oversight for agentic-AI systems",
  categories: [
    { id: "agents", name: "Agents" },
    { id: "runtime", name: "Runtime & Access" },
    { id: "memory", name: "Memory" },
    { id: "governance", name: "Governance" },
    { id: "knowledge", name: "Knowledge" },
    { id: "boundaries", name: "Boundaries" },
  ],
  stencils: [
    // Agents
    stencil("agent", "AI Agent", "agents", "container", "AGT", {
      type: "object",
      additionalProperties: false,
      properties: {
        model: { type: "string", description: "Model identifier, e.g. claude-opus-4-6, gpt-5.2" },
        provider: { type: "string", enum: PROVIDER_ENUM },
        role: {
          type: "string",
          enum: ["single", "sub-agent", "specialist", "planner", "executor", "critic"],
          description: "This agent's part in the coordination pattern (see the orchestrator stencil for the hub role)",
        },
        autonomyLevel: {
          type: "string",
          enum: AUTONOMY_ENUM,
          description: "How much human sign-off gates this agent's actions, per the suggest→approve→act→full-auto spectrum",
        },
        contextStrategy: { type: "string", enum: CONTEXT_STRATEGY_ENUM },
        goal: { type: "string", description: "One-line objective or role of this agent" },
        dataAccessScope: {
          type: "string",
          description: "What data/systems this agent may read or write, in prose (Atlas has no ACL model)",
        },
        evaluationApproach: {
          type: "string",
          description: 'How this agent\'s output quality/safety is checked, e.g. "LLM-as-judge weekly + golden-set regression"',
        },
      },
    }),
    stencil("orchestrator-agent", "Orchestrator Agent", "agents", "container", "ORC", {
      type: "object",
      additionalProperties: false,
      properties: {
        model: { type: "string" },
        provider: { type: "string", enum: PROVIDER_ENUM },
        coordinationPattern: {
          type: "string",
          enum: ["supervisor", "hierarchical", "pipeline", "router", "evaluator-optimizer", "swarm-mesh"],
          description: "Which coordination pattern this orchestrator implements",
        },
        autonomyLevel: { type: "string", enum: AUTONOMY_ENUM },
        contextStrategy: { type: "string", enum: CONTEXT_STRATEGY_ENUM },
        goal: { type: "string" },
      },
    }),

    // Runtime & Access
    stencil("agent-runtime", "Agent Runtime", "runtime", "container", "RUN", {
      type: "object",
      additionalProperties: false,
      properties: {
        framework: { type: "string", description: "e.g. LangGraph, OpenAI Agents SDK, CrewAI, Custom" },
        hostingModel: { type: "string", enum: ["managed-paas", "serverless", "kubernetes", "vm", "on-device"] },
        concurrencyModel: { type: "string", enum: ["single-instance", "pooled", "per-request"] },
        stateBackend: { type: "string", description: "Where agent/session state persists, e.g. Redis, Postgres checkpoint" },
      },
    }),
    stencil("model-gateway", "Model Gateway", "runtime", "container", "GTW", {
      type: "object",
      additionalProperties: false,
      properties: {
        providers: { type: "array", items: { type: "string" }, description: "Upstream providers routed through this gateway" },
        routingStrategy: {
          type: "string",
          enum: ["fixed", "cost-optimised", "latency-optimised", "fallback-chain", "load-balanced"],
        },
        caching: { type: "boolean" },
        rateLimiting: { type: "boolean" },
      },
    }),
    stencil("mcp-server", "MCP Server", "runtime", "container", "MCP", {
      type: "object",
      additionalProperties: false,
      properties: {
        transport: { type: "string", enum: ["stdio", "streamable-http"] },
        primitivesExposed: {
          type: "array",
          items: { type: "string", enum: ["tools", "resources", "prompts", "sampling", "elicitation"] },
        },
        authModel: { type: "string", enum: ["none", "api-key", "oauth", "mtls"] },
      },
    }),
    stencil("sandbox", "Code Execution Sandbox", "runtime", "container", "SBX", {
      type: "object",
      additionalProperties: false,
      properties: {
        isolation: { type: "string", enum: ["container", "microvm", "wasm", "process-jail", "none"] },
        language: { type: "string" },
        networkAccess: { type: "string", enum: ["none", "allowlist", "full"] },
        timeoutSeconds: { type: "integer", minimum: 1 },
      },
    }),

    // Memory
    stencil("vector-memory", "Vector / Semantic Memory", "memory", "component", "VEC", {
      type: "object",
      additionalProperties: false,
      properties: {
        embeddingModel: { type: "string" },
        dimensions: { type: "integer", minimum: 1 },
        retrievalStrategy: {
          type: "string",
          enum: ["similarity", "hybrid-keyword-vector", "reranked", "graph-augmented"],
        },
        freshness: { type: "string", enum: ["static-snapshot", "batch-refresh", "real-time"] },
      },
    }),
    stencil("episodic-memory", "Episodic Memory", "memory", "component", "EPI", {
      type: "object",
      additionalProperties: false,
      properties: {
        retentionWindow: { type: "string", description: 'e.g. "30 days", "session-only", "indefinite"' },
        storageForm: { type: "string", enum: ["transcript-log", "summarised", "structured-events"] },
        scope: { type: "string", enum: ["per-user", "per-session", "per-agent", "shared"] },
      },
    }),

    // Governance
    stencil("guardrail", "Guardrail", "governance", "component", "GRD", {
      type: "object",
      additionalProperties: false,
      properties: {
        guardrailType: {
          type: "string",
          enum: ["input-filter", "output-filter", "policy-engine", "content-safety", "pii-redaction", "jailbreak-detection"],
        },
        enforcement: { type: "string", enum: ["block", "redact", "flag-for-review", "log-only"] },
        vendor: { type: "string", description: "e.g. Llama Guard, Azure AI Content Safety, custom rules" },
      },
    }),
    stencil("evaluator", "Evaluator", "governance", "component", "EVL", {
      type: "object",
      additionalProperties: false,
      properties: {
        method: {
          type: "string",
          enum: ["llm-as-judge", "rule-based", "human-review-sampling", "golden-set-regression", "statistical-drift"],
        },
        cadence: { type: "string", enum: ["per-request", "batched", "scheduled", "ad-hoc"] },
        metric: { type: "string", description: 'e.g. "faithfulness, toxicity, task-success-rate"' },
      },
    }),
    stencil("human-approval-gate", "Human Approval Gate", "governance", "component", "APR", {
      type: "object",
      additionalProperties: false,
      properties: {
        triggerCondition: { type: "string", description: 'e.g. "refunds over £100", "any production restart"' },
        slaMinutes: { type: "integer", minimum: 1 },
        fallback: { type: "string", enum: ["block", "auto-deny", "escalate"] },
      },
    }),

    // Knowledge
    stencil("tool", "Tool", "knowledge", "component", "TL", {
      type: "object",
      additionalProperties: false,
      properties: {
        protocol: { type: "string", enum: ["function-calling", "mcp", "openapi", "plugin", "rpc"] },
        sideEffects: { type: "string", enum: ["read-only", "mutating", "irreversible"] },
        authScope: { type: "string", description: 'e.g. "read:calendar, write:tickets"' },
        rateLimit: { type: "string" },
      },
    }),
    stencil("prompt-template", "Prompt / Instruction Template", "knowledge", "component", "PMT", {
      type: "object",
      additionalProperties: false,
      properties: {
        templateType: { type: "string", enum: ["system-prompt", "few-shot", "mcp-prompt", "output-schema"] },
        version: { type: "string" },
        variables: { type: "array", items: { type: "string" } },
      },
    }),

    // Boundaries
    stencil("agent-swarm", "Agent Swarm", "boundaries", "group", "SWM"),
  ],
};
