# Research: modelling AI agents as an Atlas stencil pack

Findings recorded before implementation, per the pattern set by `docs/research.md`. This
covers (1) how the industry currently describes agentic-AI architecture, (2) how existing
C4-family tooling handles it, and (3) a build-ready design for an `ai-agents` stencil pack
that follows Atlas's existing pack format and metamodel rules exactly. No code is touched
by this document — it is research and design only.

## 0. Constraints this design must respect (read from the codebase, not assumed)

- **Extension over enumeration (Architecture Principle 7).** `packages/core/src/metamodel/types.ts`
  fixes `ElementKind` to `person | system | container | component | group` and comments
  that packs "map onto one of these kinds" without ever adding a kind. This design adds
  **zero** new kinds — every stencil below maps onto `container`, `component`, or `group`.
- **Containment and view placement come from the kind, never the stencil**
  (`packages/core/src/metamodel/rules.ts`, `LEGAL_SCOPES` and `VIEW_PLACEMENT`):
  container → must live inside a system; component → must live inside a container.
  `VIEW_PLACEMENT` puts containers on both `container` and `component` views, and
  components only on `component` views — confirmed by reading `rules.ts` lines 88–94.
  This is exactly the split the task brief described, and it drives the container-vs-
  component call for every stencil below.
- **Pack format** (`docs/stencil-format.md`, `packages/core/src/stencils/packs.ts`):
  a pack is `{formatVersion, id, name, version, description, categories[], stencils[]}`;
  each `Stencil` has `id, name, category, elementType, symbol2d, symbolIso, defaults?,
  attributeSchema?` (JSON Schema 2020-12, validated by Ajv at command time — same path
  for UI, AI, and CLI per Architecture Principle 3). Attribute schemas are **per stencil**
  in the raw format.
- **The `definePack` helper is more restrictive than the raw format.**
  `packages/stencils/src/lib.ts` `definePack()` takes one `color` and one optional
  `attributeSchema` for the *whole pack*, applied to every non-`group` stencil via a
  `StencilTuple = [id, name, category, elementType, abbrev, technology?]`. Every existing
  pack (`c4-core`, `generic-tech`, `business`, `aws`, `azure`, `gcp`) either has no
  attribute schema or one *uniform* schema across all its stencils (e.g. every AWS
  stencil gets the same `accountId/region/arn` shape). **This pack needs a different
  schema per stencil** (an agent's schema looks nothing like a guardrail's), so it cannot
  be authored through `definePack` unchanged — see §5, Implementation checklist, for the
  two ways to resolve this.
- **Per-element fields already exist and must not be duplicated.** `Element` (same file,
  `types.ts` ~L100-127) already carries `owners`, `team`, `status` (`Lifecycle`),
  `criticality` (`Criticality`), `costs` (`CostEntry[]`), `temporal`, `tags`, `links`,
  `properties`, `technology`. Every one of these applies to an "AI Agent" container the
  same way it applies to an EC2 instance — owner, on-call team, lifecycle stage,
  criticality tier, £/€/$ run-rate, valid-from/valid-to. **None of the attribute schemas
  below repeat these.** `CostCategory` is explicitly "not user-extensible in v1"
  (`types.ts` L52), so AI inference/token spend books under the existing
  `infrastructure` or `vendor-services` category — flagged as an open question in §5 in
  case a future `ai-compute` category is wanted.
- **Default-enabled packs today**: `apps/web/src/seed.ts` enables only
  `["c4-core@1", "generic-tech@1"]` for a new workspace; `aws`/`azure`/`gcp`/`business`
  are opt-in via the palette's "Packs…" manager (`apps/web/src/components/Palette.tsx`,
  `PackManager`). This design follows that precedent (§2).
- **The palette needs no new code.** `Palette.tsx`'s `LEVELS` array groups by
  `ElementKind` only (`kinds: ["container"]`, `kinds: ["component"]`, etc.), not by pack.
  Because every stencil below maps onto an existing kind, new stencils simply appear
  under the existing "Container level" / "Component level" / "Boundaries" headings the
  moment the pack is registered — this is the mechanism that makes "extension over
  enumeration" true in practice, not just in principle.

## 1. How the industry describes agentic-AI architecture (2025–26)

- **Coordination patterns are converging on a short, named list.** Industry guides
  (Augment Code's "9 system designs," Redis's "5 patterns," thinking.inc's 2026 guide)
  agree on a core set: **single-agent loop, orchestrator/supervisor–worker,
  hierarchical, pipeline, router, evaluator-optimizer loop, and swarm/mesh** — production
  systems typically combine two or three of these rather than picking one purely. The
  **orchestrator/sub-agent** shape recurs everywhere: "an orchestrator, a small set of
  specialised sub-agents, and shared structured memory," where the orchestrator does
  task decomposition and tool/agent selection and dispatches to workers that each own a
  narrow tool domain. The **planner–executor** split (plan is data, execution is a
  separate loop over that plan) is called out as its own recognised pattern distinct from
  orchestrator/worker.
  [AI Agent Orchestration Patterns (2026 Guide)](https://thinking.inc/en/blue-ocean/agentic/agent-orchestration-patterns/) ·
  [Agentic AI Architecture Patterns: 9 System Designs](https://www.augmentcode.com/guides/agentic-ai-architecture-patterns) ·
  [Agentic AI Architecture: 5 Patterns Explained (Redis)](https://redis.io/blog/agentic-ai-architecture-examples/)

- **Runtime building blocks are stable across sources**: a model/LLM gateway abstracting
  providers; tool/function-calling as the action surface; MCP servers/clients as the
  emerging standard for exposing that surface; memory split into short-term (context
  window), semantic/vector (RAG-style recall), and episodic (timestamped event log of
  what actually happened); guardrails as layered, defence-in-depth checks (cheap
  deterministic filters first, slower ML/LLM judges behind them, human review for the
  highest-risk decisions); evaluators/critics as a distinct concern from guardrails
  (quality/correctness scoring vs. safety/policy enforcement, though the same "LLM as
  judge" technique often implements both); human-in-the-loop as an explicit gate with a
  trigger condition and a fallback, not just "a person is watching"; and sandboxes for
  isolating agent-executed code.
  [AI Agent Guardrails Framework (Galileo)](https://galileo.ai/blog/ai-agent-guardrails-framework) ·
  [Understanding guardrails for AI agents (W&B)](https://wandb.ai/site/articles/guardrails-for-ai-agents/) ·
  [Agent Memory Architectures: Vector vs Graph vs Episodic](https://www.digitalapplied.com/blog/agent-memory-architectures-vector-graph-episodic) ·
  [Agentic AI Memory vs Vector Database: Architecture Guide 2026 (Atlan)](https://atlan.com/know/agentic-ai-memory-vs-vector-database/)

- **MCP has a clean, small architecture that maps directly onto stencils.** Per
  Anthropic/the MCP spec: an **MCP Host** (the AI application) creates one **MCP Client**
  per connection, each client holding a dedicated session with one **MCP Server**; the
  server exposes three primitives — **tools** (actions), **resources** (context data),
  and **prompts** (interaction templates) — over a JSON-RPC data layer carried by either
  stdio (local) or Streamable HTTP (remote, OAuth-capable) transport. This maps cleanly:
  the *host* is the agent/agent-runtime container itself (no separate stencil needed —
  it's whichever container is doing the calling), the *client* is a relationship
  attribute (technology tag `"MCP"`) rather than a box, and the **server** and its
  **tools/prompts** are exactly the `mcp-server` container and `tool`/`prompt-template`
  components below.
  [Architecture overview – Model Context Protocol](https://modelcontextprotocol.io/docs/learn/architecture) ·
  [Introducing the Model Context Protocol (Anthropic)](https://www.anthropic.com/news/model-context-protocol)

- **Autonomy is a spectrum with an emerging common vocabulary**, not a binary
  "autonomous or not." Multiple 2026 sources converge on the same shape even where the
  exact label wording differs: a **suggest** tier where the agent proposes and a human
  must act; an **approve** tier where the agent prepares the action but a human must
  authorise each one (or each risky one) before it executes; an **act** tier where the
  agent executes routine/reversible actions itself and only escalates the risky ones;
  and a **full-autonomy** tier where the agent proceeds and reports after the fact.
  Anthropic's own applied-research framing stresses that most production agents mix tiers
  *within one workflow* by action type, not by agent — e.g. "the same agent might
  autonomously route tickets but pause for approval before a refund over £100." This is
  exactly why autonomy is modelled below as a **per-agent attribute**, not a separate
  stencil per tier — a tier is a value, not a different kind of box.
  [Autonomy Levels for Agentic AI (Cloud Security Alliance)](https://cloudsecurityalliance.org/blog/2026/01/28/levels-of-autonomy) ·
  [Measuring AI agent autonomy in practice (Anthropic)](https://www.anthropic.com/research/measuring-agent-autonomy)

## 2. How C4-family and other modelling notations already handle agents

- **The most directly relevant precedent is a 2026 paper explicitly extending C4 for
  agentic systems**: "Describing Agentic AI Systems with C4: Lessons from Industry
  Projects." It keeps C4's layered Context→Container→Component structure but adds an
  agent-specific vocabulary of **agents, artifacts (the things agents exchange),
  tools, and coordination patterns**, arguing that ad-hoc pipeline sketches fail to
  capture the "style-defining concerns" of agentic systems — i.e. *how* agents
  coordinate (orchestration vs. choreography) matters as much as *what* they contain.
  This validates Atlas's approach of keeping the four C4 abstraction levels intact and
  layering an agent vocabulary *on top* via a pack, rather than inventing a fifth level
  or a parallel notation.
  [Describing Agentic AI Systems with C4: Lessons from Industry Projects](https://arxiv.org/abs/2603.15021)
- **Structurizr** (Simon Brown's reference C4 tool) has not added agent-specific shapes;
  its 2026 "AI + MCP" work is about *using* AI/MCP to author and query Structurizr
  models (an MCP server that does DSL validation/parsing), not about *depicting* agent
  architectures with new notation. That is consistent with treating agent concepts as an
  ordinary vocabulary extension rather than a notation change.
  [AI + MCP | Structurizr](https://docs.structurizr.com/ai)
- **No ArchiMate-official agent metamodel extension was found** in this pass; ArchiMate's
  existing Application Component / Application Service / Technology Service layers are
  sometimes used ad hoc for agents in practice, but nothing as codified as the C4 paper
  above. Not citing further here to avoid overstating a negative result — flagged as an
  area with less precedent than MCP/autonomy.
- **Net takeaway for Atlas**: no tool in this space has introduced new *element kinds*
  for agents — every serious treatment (the C4 paper, Structurizr's own roadmap) either
  stays within C4's four levels or treats "agent-aware" as a documentation/tooling
  concern layered on top. This directly supports the brief's "extension over enumeration"
  instruction — a stencil pack is not just *permitted* here, it is what the state of the
  art actually does.

## 3. Attributes architects need per agent — and what Atlas already has

Cross-referencing the runtime building blocks in §1 against `Element`'s existing fields
(§0) gives a clean split:

| Concern | Already on every `Element` | New, agent-specific (goes in `attributeSchema`) |
|---|---|---|
| Ownership / accountability | `owners`, `team` | — |
| Lifecycle | `status` (`Lifecycle`) | — |
| Risk tier | `criticality` | — |
| Cost / TCO | `costs` (`CostEntry[]`) | — |
| Validity window | `temporal` | — |
| Free-form metadata | `tags`, `properties`, `links`, `documentation` | — |
| Model + provider | — | `model`, `provider` |
| Autonomy | — | `autonomyLevel` (suggest / approve / act / full-auto) |
| Context strategy | — | `contextStrategy` |
| Data access scope | — | `dataAccessScope` (free text; Atlas has no ACL model) |
| Evaluation approach | — | `evaluationApproach` (free text summary; the *mechanism* gets its own `evaluator` stencil when it's a first-class model object) |
| Tool inventory | — | modelled as **relationships** to `tool` components, not a text field (§4) — the model already has a place for "what this connects to" |
| Cost *profile* | `costs` covers amount/category/classification | nothing new — an agent's inference spend is a normal `CostEntry` on the agent or gateway element |

This is the guiding rule applied throughout §4: if Atlas already has a field for it
(owner, cost, criticality, lifecycle, tags, links), the pack does not re-ask for it.

## 4. The `ai-agents` pack

### 4.1 Manifest

```json
{
  "formatVersion": 1,
  "id": "ai-agents",
  "name": "AI Agents",
  "version": "1.0.0",
  "description": "Agents, orchestration, tools, memory, guardrails and human oversight for agentic-AI systems"
}
```

- **Default-enabled: no.** Follows the same precedent as `aws`/`azure`/`gcp`/`business` —
  `apps/web/src/seed.ts` stays at `["c4-core@1", "generic-tech@1"]`; users opt in via
  **Packs…** the same way they opt into a cloud vocabulary. An AI-agents workspace is a
  minority of Atlas workspaces at any one time, same as an AWS-specific one.
- **Colour: `#4f46e5` (indigo-600).** Distinct from every existing pack hue — `c4-core`
  sky `#0284c7`, `business` purple `#9333ea`, `azure` blue `#2563eb`, `gcp` green
  `#059669`, `aws` orange `#e8791b`, `generic-tech` slate `#475569`. Indigo/violet is
  also the closest thing to a genAI-associated colour across current design systems
  without literally reusing a specific vendor's brand colour (avoiding the same
  trademark concern the built-in packs already dodge by using generated glyphs instead
  of provider artwork, per `lib.ts`'s file comment).
- **Categories** (mirrors the cloud packs' functional grouping, §general convention):

  | id | name |
  |---|---|
  | `agents` | Agents |
  | `runtime` | Runtime & Access |
  | `memory` | Memory |
  | `governance` | Governance |
  | `knowledge` | Knowledge |
  | `boundaries` | Boundaries |

### 4.2 Stencils (14)

Every stencil's `elementType` is justified against `LEGAL_SCOPES`/`VIEW_PLACEMENT`
(§0): things that are independently deployable/addressable units of the estate
(an agent, a gateway, an MCP server) are **containers**; things that only make sense
nested inside one of those (a tool, a memory store, a guardrail check) are
**components**; a cluster boundary is a **group**. No new kind is introduced.

#### Agents (`agents`)

**1. `agent` — "AI Agent" — `container`**
One-line: A single autonomous or semi-autonomous agent — a reasoning loop over a model,
a role/goal, and a set of tools; the sub-agent, specialist, planner, or executor in any
of the §1 coordination patterns. Kept as *one* stencil across all those roles
(`role` is an attribute, not a stencil) so the pack doesn't enumerate a stencil per
pattern — the same "extension over enumeration" argument the brief makes for kinds
applies one level down to stencils themselves.
Glyph: `AGT` on indigo tile.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "model": { "type": "string", "description": "Model identifier, e.g. claude-opus-4-6, gpt-5.2" },
    "provider": {
      "type": "string",
      "enum": ["anthropic", "openai", "google", "azure-openai", "aws-bedrock", "mistral", "meta", "self-hosted", "other"]
    },
    "role": {
      "type": "string",
      "enum": ["single", "sub-agent", "specialist", "planner", "executor", "critic"],
      "description": "This agent's part in the coordination pattern (see the orchestrator stencil for the hub role)"
    },
    "autonomyLevel": {
      "type": "string",
      "enum": ["suggest", "approve", "act", "full-auto"],
      "description": "How much human sign-off gates this agent's actions, per the suggest→approve→act→full-auto spectrum"
    },
    "contextStrategy": {
      "type": "string",
      "enum": ["stateless", "short-term-window", "rag", "long-term-memory", "hybrid"]
    },
    "goal": { "type": "string", "description": "One-line objective or role of this agent" },
    "dataAccessScope": { "type": "string", "description": "What data/systems this agent may read or write, in prose (Atlas has no ACL model)" },
    "evaluationApproach": { "type": "string", "description": "How this agent's output quality/safety is checked, e.g. \"LLM-as-judge weekly + golden-set regression\"" }
  }
}
```

**2. `orchestrator-agent` — "Orchestrator Agent" — `container`**
One-line: The hub in orchestrator/supervisor, hierarchical, router, or
evaluator-optimizer patterns (§1) — decomposes a task and dispatches to sub-agents;
kept distinct from plain `agent` (rather than a `role: orchestrator` value) because
it is visually load-bearing: a reader should be able to spot the coordination hub in
a multi-agent diagram at a glance, the same reason `generic-tech` gives `queue` and
`event-bus` distinct glyphs despite both being messaging containers.
Glyph: `ORC` on indigo tile (same colour family, distinct abbreviation).
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "model": { "type": "string" },
    "provider": {
      "type": "string",
      "enum": ["anthropic", "openai", "google", "azure-openai", "aws-bedrock", "mistral", "meta", "self-hosted", "other"]
    },
    "coordinationPattern": {
      "type": "string",
      "enum": ["supervisor", "hierarchical", "pipeline", "router", "evaluator-optimizer", "swarm-mesh"],
      "description": "Which §1 coordination pattern this orchestrator implements"
    },
    "autonomyLevel": { "type": "string", "enum": ["suggest", "approve", "act", "full-auto"] },
    "contextStrategy": { "type": "string", "enum": ["stateless", "short-term-window", "rag", "long-term-memory", "hybrid"] },
    "goal": { "type": "string" }
  }
}
```

#### Runtime & Access (`runtime`)

**3. `agent-runtime` — "Agent Runtime" — `container`**
One-line: The deployable process/service that hosts one or more agents' reasoning loop
(a LangGraph app, an OpenAI Agents SDK service, a custom loop) — the infra substrate,
as distinct from the logical `agent`/`orchestrator-agent` it hosts. Used when the
hosting choice matters for cost/ops (e.g. attributing a Fargate bill), connected to the
agents it runs via an ordinary "runs on" relationship (containers can't nest inside
containers in Atlas, so this is a sibling, not a parent, per `LEGAL_SCOPES`).
Glyph: `RUN`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "framework": { "type": "string", "description": "e.g. LangGraph, OpenAI Agents SDK, CrewAI, Custom" },
    "hostingModel": { "type": "string", "enum": ["managed-paas", "serverless", "kubernetes", "vm", "on-device"] },
    "concurrencyModel": { "type": "string", "enum": ["single-instance", "pooled", "per-request"] },
    "stateBackend": { "type": "string", "description": "Where agent/session state persists, e.g. Redis, Postgres checkpoint" }
  }
}
```

**4. `model-gateway` — "Model Gateway" — `container`**
One-line: The proxy/router that abstracts one or more upstream model providers behind
one interface — the "LLM/model gateway" building block from §1.
Glyph: `GTW`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "providers": { "type": "array", "items": { "type": "string" }, "description": "Upstream providers routed through this gateway" },
    "routingStrategy": { "type": "string", "enum": ["fixed", "cost-optimised", "latency-optimised", "fallback-chain", "load-balanced"] },
    "caching": { "type": "boolean" },
    "rateLimiting": { "type": "boolean" }
  }
}
```

**5. `mcp-server` — "MCP Server" — `container`**
One-line: An MCP server exposing tools/resources/prompts to agents (§1/§2) — the MCP
*client* and *host* are not separate stencils: the host is whichever `agent`/
`agent-runtime` container is calling in, and the client connection is a relationship
attribute (`technology: ["MCP"]`, §4.3), matching how MCP itself treats the client as
"a component that maintains a connection," not a deployable unit of its own.
Glyph: `MCP`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "transport": { "type": "string", "enum": ["stdio", "streamable-http"] },
    "primitivesExposed": {
      "type": "array",
      "items": { "type": "string", "enum": ["tools", "resources", "prompts", "sampling", "elicitation"] }
    },
    "authModel": { "type": "string", "enum": ["none", "api-key", "oauth", "mtls"] }
  }
}
```

**6. `sandbox` — "Code Execution Sandbox" — `container`**
One-line: An isolated runtime an agent uses to execute generated code (the "sandboxes /
code execution" building block from §1) — a deployable unit in its own right, hence
`container` not `component`.
Glyph: `SBX`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "isolation": { "type": "string", "enum": ["container", "microvm", "wasm", "process-jail", "none"] },
    "language": { "type": "string" },
    "networkAccess": { "type": "string", "enum": ["none", "allowlist", "full"] },
    "timeoutSeconds": { "type": "integer", "minimum": 1 }
  }
}
```

> **Reuse, don't duplicate:** scheduling/triggering ("schedulers/cron, event triggers"
> in §1) is already covered by `generic-tech`'s `scheduler` (container), `queue` and
> `event-bus` (containers) — an agent's cron trigger is a `scheduler` connected to the
> agent by a "triggers" relationship, not a new stencil. Likewise a raw document corpus
> feeding retrieval is a `generic-tech` `database` or `file-store`, connected to the
> `vector-memory` component below by an "indexes" relationship — `vector-memory`
> represents the embedding store, not the source of truth.

#### Memory (`memory`)

**7. `vector-memory` — "Vector / Semantic Memory" — `component`**
One-line: An embedding store an agent retrieves semantically similar context from — the
RAG-style memory building block from §1. `component` because it is a piece of an
agent's or runtime's internals, not independently deployable in the C4 sense used here
(if it *is* independently significant, e.g. a shared Pinecone index serving many
agents, model it with `generic-tech`'s `database` container instead and connect
`vector-memory` components to it — see §4.3).
Glyph: `VEC`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "embeddingModel": { "type": "string" },
    "dimensions": { "type": "integer", "minimum": 1 },
    "retrievalStrategy": { "type": "string", "enum": ["similarity", "hybrid-keyword-vector", "reranked", "graph-augmented"] },
    "freshness": { "type": "string", "enum": ["static-snapshot", "batch-refresh", "real-time"] }
  }
}
```

**8. `episodic-memory` — "Episodic Memory" — `component`**
One-line: A timestamped log of what an agent actually did (turns, tool calls, outcomes)
— distinct from `vector-memory` because its retrieval and retention semantics differ
(recency/session-scoped vs. semantic similarity over a corpus), matching the explicit
vector-vs-episodic split the brief and the memory-architecture research (§1) both draw.
Glyph: `EPI`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "retentionWindow": { "type": "string", "description": "e.g. \"30 days\", \"session-only\", \"indefinite\"" },
    "storageForm": { "type": "string", "enum": ["transcript-log", "summarised", "structured-events"] },
    "scope": { "type": "string", "enum": ["per-user", "per-session", "per-agent", "shared"] }
  }
}
```

#### Governance (`governance`)

**9. `guardrail` — "Guardrail" — `component`**
One-line: A policy/safety check on an agent's input or output — the defence-in-depth
layer from §1 (deterministic filter, ML classifier, or LLM safety check).
Glyph: `GRD`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "guardrailType": {
      "type": "string",
      "enum": ["input-filter", "output-filter", "policy-engine", "content-safety", "pii-redaction", "jailbreak-detection"]
    },
    "enforcement": { "type": "string", "enum": ["block", "redact", "flag-for-review", "log-only"] },
    "vendor": { "type": "string", "description": "e.g. Llama Guard, Azure AI Content Safety, custom rules" }
  }
}
```

**10. `evaluator` — "Evaluator" — `component`**
One-line: An automated quality/correctness scorer — distinct from `guardrail` (safety/
policy enforcement, usually synchronous and blocking) even though both may use an
"LLM-as-judge" technique under the hood; an evaluator is about *is this good*, a
guardrail is about *is this allowed*.
Glyph: `EVL`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "method": { "type": "string", "enum": ["llm-as-judge", "rule-based", "human-review-sampling", "golden-set-regression", "statistical-drift"] },
    "cadence": { "type": "string", "enum": ["per-request", "batched", "scheduled", "ad-hoc"] },
    "metric": { "type": "string", "description": "e.g. \"faithfulness, toxicity, task-success-rate\"" }
  }
}
```

**11. `human-approval-gate` — "Human Approval Gate" — `component`**
One-line: An explicit HITL checkpoint that pauses execution pending human sign-off —
the "gate" framing (trigger condition + SLA + fallback) matches how the risk-tiered
autonomy research in §1 describes HITL, not just "a person is watching."
Glyph: `APR`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "triggerCondition": { "type": "string", "description": "e.g. \"refunds over £100\", \"any production restart\"" },
    "slaMinutes": { "type": "integer", "minimum": 1 },
    "fallback": { "type": "string", "enum": ["block", "auto-deny", "escalate"] }
  }
}
```

#### Knowledge (`knowledge`)

**12. `tool` — "Tool" — `component`**
One-line: A single callable capability an agent invokes — a function-calling tool, an
MCP tool, an OpenAPI-wrapped call, or a plugin; kept as **one** stencil across
transports (`protocol` is an attribute) rather than one stencil per protocol, again
following "extension over enumeration" one level down.
Glyph: `TL`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "protocol": { "type": "string", "enum": ["function-calling", "mcp", "openapi", "plugin", "rpc"] },
    "sideEffects": { "type": "string", "enum": ["read-only", "mutating", "irreversible"] },
    "authScope": { "type": "string", "description": "e.g. \"read:calendar, write:tickets\"" },
    "rateLimit": { "type": "string" }
  }
}
```

**13. `prompt-template` — "Prompt / Instruction Template" — `component`**
One-line: A reusable system prompt, few-shot set, or MCP "prompt" primitive — versioned
independently of the agent that uses it.
Glyph: `PMT`.
```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "templateType": { "type": "string", "enum": ["system-prompt", "few-shot", "mcp-prompt", "output-schema"] },
    "version": { "type": "string" },
    "variables": { "type": "array", "items": { "type": "string" } }
  }
}
```

#### Boundaries (`boundaries`)

**14. `agent-swarm` — "Agent Swarm" — `group`**
One-line: A boundary clustering peer agents in a swarm/mesh pattern (§1) — same role as
`aws`'s `vpc` or `generic-tech`'s `network-zone`: a labelled boundary, no attributes
(consistent with every existing `group` stencil, which `definePack`'s helper already
enforces by stripping `attributeSchema` for `elementType === "group"`).
Glyph: `SWM`.

No new `person`-kind stencil is proposed. A human approver/operator is the existing
`c4-core` `Person` — adding an agent-pack "Human Reviewer" person stencil purely for
a different label would be the kind of enumeration the brief asks to avoid; the
`human-approval-gate` component plus a plain `Person` relationship already carries the
meaning (§4.3).

### 4.3 Relationships: agent-to-agent and agent-to-tool

Atlas has one `Relationship` shape (name/verb phrase, `technology[]`, `direction`,
`tags`, `properties`) — no relationship *kinds* to extend, so this is entirely a
naming/tagging convention, not a schema change:

- **Verb phrases**, matching the tense/voice convention already used in `types.ts`'s own
  example (`"publishes booking events to"`):
  - Orchestrator → sub-agent: **"delegates &lt;task&gt; to"** / "dispatches subtask to"
  - Sub-agent → orchestrator: **"reports result to"** / "returns artifact to"
  - Agent → tool: **"invokes"**
  - Agent → model gateway: **"completes via"** / "requests generation from"
  - Agent → vector/episodic memory: **"retrieves context from"** / "logs interaction to"
  - Agent → guardrail: **"screens input through"** / "screens output through"
  - Agent → evaluator: **"scores output via"**
  - Agent → human-approval-gate: **"requests approval from"**; gate → agent:
    **"authorises"**
  - Agent/orchestrator → agent-runtime: **"runs on"**
  - Person → human-approval-gate: **"reviews and approves via"**
- **Technology tags carry the transport/protocol**, the same way `aws`'s stencils set
  `defaults.technology` today: `technology: ["MCP"]` for an MCP-mediated call,
  `["Function calling"]` for native function-calling, `["OpenAPI"]`/`["REST"]`/`["gRPC"]`
  for wrapped HTTP APIs. This mirrors `tool.protocol` rather than duplicating it as a
  relationship attribute schema (Atlas relationships have no `attributeSchema` field at
  all today — technology tags are the only structured slot available, so that's where
  transport metadata belongs).
- **Containment vs. relationship**: a `tool`/`vector-memory`/`guardrail`/etc. component's
  `parentId` should point at whichever container actually **hosts/exposes** it — usually
  an `mcp-server` (for MCP-exposed tools) or an `agent-runtime` (for in-process
  tools/memory/guardrails). The relationship from the *calling* agent is then a normal
  cross-container-to-component relationship (legal per `assertLegalEndpoints`, which
  only forbids `group` endpoints) — exactly how a C4 component diagram already shows one
  container's component depending on another container's internals.

## 5. Worked example: "Ops Copilot" agentic estate

A seed/demo an implementation agent can build directly from this bullet list (matches
the brief's ask for orchestrator + gateway + two tools + vector memory + guardrail +
human-approval gate):

- **System**: `Ops Copilot`
- **Person**: `On-call Engineer` (plain `c4-core` person)
- **Containers** (inside `Ops Copilot`):
  - `Ops Orchestrator` — stencil `orchestrator-agent`; `model: claude-opus-4-6`,
    `provider: anthropic`, `coordinationPattern: supervisor`,
    `autonomyLevel: approve`
  - `Ticket Triage Agent` — stencil `agent`; `role: sub-agent`,
    `model: claude-haiku-4-6`, `autonomyLevel: act`
  - `Runbook Executor Agent` — stencil `agent`; `role: sub-agent`,
    `autonomyLevel: approve` (its actions are irreversible)
  - `Model Gateway` — stencil `model-gateway`; `providers: ["anthropic", "openai"]`,
    `routingStrategy: fallback-chain`
  - `Agent Runtime` — stencil `agent-runtime`; `framework: LangGraph`,
    `hostingModel: kubernetes`
  - `Runbook MCP Server` — stencil `mcp-server`; `transport: streamable-http`,
    `primitivesExposed: ["tools"]`, `authModel: oauth`
- **Components**:
  - `Restart Service Tool` (stencil `tool`, parent `Runbook MCP Server`;
    `protocol: mcp`, `sideEffects: irreversible`)
  - `Query Metrics Tool` (stencil `tool`, parent `Runbook MCP Server`;
    `protocol: mcp`, `sideEffects: read-only`)
  - `Incident Vector Store` (stencil `vector-memory`, parent `Agent Runtime`;
    `embeddingModel: text-embedding-4`, `retrievalStrategy: hybrid-keyword-vector`)
  - `Safety Guardrail` (stencil `guardrail`, parent `Agent Runtime`;
    `guardrailType: policy-engine`, `enforcement: block`)
  - `Response Evaluator` (stencil `evaluator`, parent `Agent Runtime`;
    `method: llm-as-judge`, `cadence: per-request`)
  - `On-call Approval Gate` (stencil `human-approval-gate`, parent `Agent Runtime`;
    `triggerCondition: "service restart in production"`, `slaMinutes: 15`,
    `fallback: block`)
- **Relationships**:
  - `Ops Orchestrator` —"delegates triage to"→ `Ticket Triage Agent`
  - `Ops Orchestrator` —"delegates remediation to"→ `Runbook Executor Agent`
  - `Ticket Triage Agent` —"reports findings to"→ `Ops Orchestrator`
  - `Ticket Triage Agent` —"retrieves context from"→ `Incident Vector Store`
  - `Runbook Executor Agent` —"requests approval from"→ `On-call Approval Gate`
  - `On-call Approval Gate` —"authorises"→ `Runbook Executor Agent`
  - `Runbook Executor Agent` —"invokes"→ `Restart Service Tool`
    (`technology: ["MCP"]`)
  - `Runbook Executor Agent` —"invokes"→ `Query Metrics Tool` (`technology: ["MCP"]`)
  - `Runbook Executor Agent` —"screens output through"→ `Safety Guardrail`
  - `Ops Orchestrator`, `Ticket Triage Agent`, `Runbook Executor Agent` —"completes
    via"→ `Model Gateway`
  - `Ops Orchestrator` —"scores output via"→ `Response Evaluator`
  - `Ops Orchestrator`, `Ticket Triage Agent`, `Runbook Executor Agent` —"runs on"→
    `Agent Runtime` (`technology: ["LangGraph"]`)
  - `On-call Engineer` —"reviews and approves via"→ `On-call Approval Gate`
- **Costs** (existing `CostEntry`, no schema change): a recurring `infrastructure`
  cost on `Model Gateway` for token spend; a recurring `vendor-services` cost on
  `Safety Guardrail` if it's a paid third-party classifier.
- **Views**: a container view for `Ops Copilot` shows all six containers; a component
  view scoped to `Agent Runtime` shows the memory/guardrail/evaluator/gate components
  plus, cross-container, the two `Runbook MCP Server` tools the executor invokes.

## 6. Implementation checklist

Exact files, in the order a build would touch them:

1. **`packages/stencils/src/ai-agents-pack.ts`** (new). Hand-author the `StencilPack`
   against the raw `Stencil`/`StencilPack` interfaces from `packages/core/src/stencils/
   packs.ts` rather than `definePack()` — §0 established that `definePack` forces one
   `attributeSchema` per pack, but this pack needs one per stencil. Reuse
   `symbol2d(abbrev, color)` / `symbolIso(abbrev, color)` from `packages/stencils/src/
   lib.ts` (already exported) to keep the glyph look consistent with every other pack —
   these are plain functions, not tied to `definePack`, so this needs no core change.
   **Open question**: alternatively, extend `PackSpec`/`StencilTuple` in `lib.ts` to
   accept a per-stencil schema override (e.g. a 7th tuple slot or a `schemas: Record<
   stencilId, JSONSchema>` map on `PackSpec`, applied over the uniform one). That would
   let future multi-schema packs use the helper too, but it's a `packages/stencils`
   behaviour change outside this task's "touch no other file" scope — flagged for the
   implementer to decide, not decided here.
2. **`packages/stencils/src/index.ts`**: import `aiAgentsPack` and append it to
   `BUILTIN_PACKS` (after `businessPack`, before the cloud packs, to keep "our own
   vocabulary" grouped before "third-party cloud vocabulary" the way the file already
   orders `c4-core, generic-tech, business` before `aws, azure, gcp`); export it
   alongside the others.
3. **`packages/stencils/test/packs.test.ts`**: no change required for the generic
   assertions (they iterate `BUILTIN_PACKS`), but add one pack-specific test mirroring
   the existing "aws pack exposes VPC as a group boundary" case, e.g. asserting
   `agent-swarm` has `elementType === "group"` and no `attributeSchema`, and that
   `agent`/`orchestrator-agent`/`agent-runtime`/`model-gateway`/`mcp-server`/`sandbox`
   are all `container` while the rest are `component`.
4. **`apps/web/src/seed.ts`** (line 20): deliberately **no change** — keep
   `stencilPacks: ["c4-core@1", "generic-tech@1"]` so `ai-agents` stays opt-in like the
   cloud/business packs (§4.1 decision).
5. **`apps/web/src/components/Palette.tsx`**: no change needed — `LEVELS` filters by
   `ElementKind`, and every stencil here maps onto `container`/`component`/`group`, so
   they surface automatically once the pack is registered and enabled. Worth a manual
   check after wiring it up that the "Container level" section doesn't get crowded
   (6 new containers alongside `generic-tech`'s existing 7) — no code change, just a
   visual sanity check.
6. **`packages/ai/src/chat.ts`** (`SYSTEM_PROMPT`, ~line 20): the existing line already
   generalises ("components... only on component views") so no *correction* is needed,
   but add one clause so the assistant knows to reach for this vocabulary when a user
   describes an agentic system, e.g. append to the rules list: *"If the user describes
   an agent, orchestrator, tool-calling, RAG/memory, guardrail, evaluator, or
   human-approval concept and the `ai-agents` pack is enabled, prefer its stencils
   (`create_elements` with a `stencil` reference) over generic containers/components —
   check `query_model`/enabled packs first since the pack may not be enabled."* Exact
   wording is the implementer's call; the point is a single added bullet, not a
   rewrite.
7. **`docs/user-guide.md`** (~line 268-277, the "built-in packs" table): add a row
   `| ai-agents | AI Agents | Agents, orchestration, tools, memory, guardrails, human
   approval (14) |` and update the "Cloud packs are off by default" framing sentence at
   ~L44/188 if it enumerates packs by name.
8. **`apps/web/src/helpContent.tsx`** (~line 41): the "enabling stencil packs (AWS,
   Azure, GCP, generic tech, and the C4 core shapes)" sentence should gain ", business,
   and AI agents" (it's already stale re: `business` today, so this is a good moment to
   fix both in one edit rather than compounding the omission).
9. **`apps/web/e2e/stencils.spec.ts`**: add an `"ai-agents pack"` describe block
   mirroring the existing AWS tests — toggle the pack on, place an `agent` (verify
   container symbol/technology), verify `mcp-server` → `tool` containment works
   (component nests under the container from the palette when scoped correctly, same
   drill-down pattern as the existing "modelling an AWS workload" test), verify
   attribute-schema validation on one enum field (e.g. `autonomyLevel` rejecting a
   bogus value the way `accountId`'s regex is exercised today), and verify
   `agent-swarm` creates a group boundary the same way the existing VPC test does.
10. **`docs/stencil-format.md`**: no change required — the format already documents
    per-stencil `attributeSchema` and this pack uses nothing outside that contract.

### Open questions

- **Per-stencil schemas through `definePack`** (item 1 above): worth resolving one way
  before or during implementation so future multi-schema packs (and there will be more —
  a data-mesh pack, an IoT pack) don't each reinvent hand-authoring.
- **`CostCategory` extensibility**: today's fixed enum (`licences | infrastructure |
  people | vendor-services | change | decommission | other`) has no `ai-compute` /
  `model-inference` bucket; token spend currently has to book under `infrastructure` or
  `vendor-services`. Not blocking — flagged in case TCO reporting later wants inference
  spend broken out separately from general infra.
- **Shared vs. per-agent memory**: the worked example parents `Incident Vector Store`
  under `Agent Runtime` so both sub-agents can reach it via relationships; if a future
  workspace wants to show a memory store shared across *systems* (not just within one),
  it should be modelled as a `generic-tech` `database` container with `vector-memory`
  components as thin per-agent views onto it, per the "reuse, don't duplicate" note in
  §4.2 — worth a line in the user guide once this pack ships, not a blocker now.
- **Whether `agent-runtime` earns its keep**: it's the one stencil in this pack without
  a hard external-source citation forcing its existence (§1's building-block list
  doesn't name it explicitly) — included because the brief's own framing ("agent
  runtimes/orchestrators likely container") calls for it and because separating
  infra-hosting concerns from logical-agent concerns matches how Atlas already
  separates `system`/`container` generally, but it's the stencil most likely to be cut
  or merged into `agent` if early usage shows nobody reaches for it separately.
