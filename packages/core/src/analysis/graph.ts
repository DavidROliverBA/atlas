/**
 * Estate-wide graph analysis (§3.5): ego networks, impact traversal,
 * dependency matrix and consistency reports — all derived from the model,
 * never drawn by hand.
 */

import type { Ulid } from "../ids.js";
import type { Relationship } from "../metamodel/types.js";
import type { Workspace } from "../model/workspace.js";

export type DirectionFilter = "in" | "out" | "both";

export interface EgoNetworkOptions {
  depth?: number;
  direction?: DirectionFilter;
  /** Only follow relationships carrying at least one of these tags. */
  tags?: string[];
}

export interface EgoNetwork {
  center: Ulid;
  /** Element id → hop distance from the centre. */
  elements: Map<Ulid, number>;
  relationships: Relationship[];
}

/** Breadth-first ego network around an element, across the whole estate. */
export function egoNetwork(ws: Workspace, center: Ulid, options: EgoNetworkOptions = {}): EgoNetwork {
  const depth = options.depth ?? 1;
  const direction = options.direction ?? "both";
  ws.element(center);

  const matchesTags = (r: Relationship) =>
    !options.tags?.length || r.tags?.some((t) => options.tags?.includes(t));

  const elements = new Map<Ulid, number>([[center, 0]]);
  const relationships = new Map<Ulid, Relationship>();
  let frontier = [center];

  for (let hop = 1; hop <= depth && frontier.length; hop++) {
    const next: Ulid[] = [];
    for (const id of frontier) {
      for (const r of ws.relationshipsOf(id)) {
        if (!matchesTags(r)) continue;
        const outbound = r.sourceId === id;
        if (direction === "out" && !outbound) continue;
        if (direction === "in" && outbound) continue;
        relationships.set(r.id, r);
        const other = outbound ? r.targetId : r.sourceId;
        if (!elements.has(other)) {
          elements.set(other, hop);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return { center, elements, relationships: [...relationships.values()] };
}

/** Everything reachable downstream of an element (impact traversal). */
export function downstreamOf(ws: Workspace, id: Ulid): Set<Ulid> {
  const network = egoNetwork(ws, id, { depth: Number.MAX_SAFE_INTEGER, direction: "out" });
  const out = new Set(network.elements.keys());
  out.delete(id);
  return out;
}

export interface DependencyMatrix {
  ids: Ulid[];
  /** counts[i][j] = number of relationships from ids[i] to ids[j]. */
  counts: number[][];
}

export function dependencyMatrix(ws: Workspace, ids?: Ulid[]): DependencyMatrix {
  const list = (ids ?? [...ws.elements.keys()].filter((id) => ws.element(id).kind !== "group")).sort();
  const index = new Map(list.map((id, i) => [id, i]));
  const counts = list.map(() => list.map(() => 0));
  for (const r of ws.relationships.values()) {
    const si = index.get(r.sourceId);
    const ti = index.get(r.targetId);
    if (si !== undefined && ti !== undefined) {
      const row = counts[si];
      if (row) row[ti] = (row[ti] ?? 0) + 1;
    }
  }
  return { ids: list, counts };
}

export type LintSeverity = "error" | "warning" | "info";

export interface LintIssue {
  code:
    | "orphan-element"
    | "duplicate-name"
    | "unplaced-relationship"
    | "unowned-critical"
    | "agent-without-guardrail"
    | "estimate-cost-on-live"
    | "undocumented-system";
  severity: LintSeverity;
  message: string;
  ids: Ulid[];
}

/** Stencils that count as oversight for an agent, per the `agent-without-guardrail` rule. */
const GUARDRAIL_STENCILS = new Set(["guardrail", "evaluator", "human-approval-gate"]);
/** Stencils that count as an "agent" for the `agent-without-guardrail` rule (excludes tools, memory, etc.). */
const AGENT_STENCILS = new Set(["agent", "orchestrator-agent"]);

/**
 * Consistency report: structural issues (orphans, duplicate names,
 * relationships never shown) plus governance/domain rules (unowned
 * criticals, agents without oversight, unverified live costs, undocumented
 * systems).
 *
 * `stale-view` (a view nobody has touched in N days) is deliberately not
 * implemented: views carry no `lastEdited` timestamp in the v1 metamodel, so
 * there is nothing to compare against yet.
 */
export function lintWorkspace(ws: Workspace): LintIssue[] {
  const issues: LintIssue[] = [];

  const placed = new Set<Ulid>();
  for (const v of ws.views.values()) for (const p of v.placements) placed.add(p.elementId);
  for (const e of ws.elements.values()) {
    if (!placed.has(e.id) && e.kind !== "group") {
      issues.push({
        code: "orphan-element",
        severity: "warning",
        message: `"${e.name}" is in the model but not on any view`,
        ids: [e.id],
      });
    }
  }

  const byScopeAndName = new Map<string, Ulid[]>();
  for (const e of ws.elements.values()) {
    const scope = ws.resolveScope(e.parentId);
    const key = `${scope?.id ?? "root"}::${e.name.toLowerCase()}`;
    byScopeAndName.set(key, [...(byScopeAndName.get(key) ?? []), e.id]);
  }
  for (const [key, ids] of byScopeAndName) {
    if (ids.length > 1) {
      const name = key.split("::")[1];
      issues.push({
        code: "duplicate-name",
        severity: "warning",
        message: `${ids.length} elements named "${name}" share the same scope`,
        ids: ids.sort(),
      });
    }
  }

  for (const r of ws.relationships.values()) {
    const shown = [...ws.views.values()].some(
      (v) =>
        v.placements.some((p) => p.elementId === r.sourceId) &&
        v.placements.some((p) => p.elementId === r.targetId) &&
        !v.hiddenRelationshipIds?.includes(r.id),
    );
    if (!shown) {
      issues.push({
        code: "unplaced-relationship",
        severity: "info",
        message: `Relationship ${ws.element(r.sourceId).name} → ${ws.element(r.targetId).name} appears on no view`,
        ids: [r.id],
      });
    }
  }

  for (const e of ws.elements.values()) {
    const isCritical = e.criticality === "high" || e.criticality === "critical";
    if (isCritical && !e.owners?.length && !e.team) {
      issues.push({
        code: "unowned-critical",
        severity: "warning",
        message: `"${e.name}" is ${e.criticality} criticality but has no owners or team`,
        ids: [e.id],
      });
    }
  }

  for (const e of ws.elements.values()) {
    if (e.stencil?.pack !== "ai-agents" || !AGENT_STENCILS.has(e.stencil.stencil)) continue;
    const hasGuardrail = ws.relationshipsOf(e.id).some((r) => {
      const otherId = r.sourceId === e.id ? r.targetId : r.sourceId;
      const other = ws.elements.get(otherId);
      return !!other?.stencil && GUARDRAIL_STENCILS.has(other.stencil.stencil);
    });
    if (!hasGuardrail) {
      issues.push({
        code: "agent-without-guardrail",
        severity: "warning",
        message: `"${e.name}" has no relationship to a guardrail, evaluator or human-approval-gate`,
        ids: [e.id],
      });
    }
  }

  for (const e of ws.elements.values()) {
    if (e.status !== "live") continue;
    const estimateCosts = (e.costs ?? []).filter((c) => !c.confidence || c.confidence === "estimate");
    if (estimateCosts.length > 0) {
      issues.push({
        code: "estimate-cost-on-live",
        severity: "info",
        message: `"${e.name}" is live but carries ${estimateCosts.length} estimate-confidence cost ${estimateCosts.length === 1 ? "entry" : "entries"}`,
        ids: [e.id],
      });
    }
  }

  for (const e of ws.elements.values()) {
    if (e.kind === "system" && !e.description && !e.documentation) {
      issues.push({
        code: "undocumented-system",
        severity: "info",
        message: `"${e.name}" is a system with no description or documentation`,
        ids: [e.id],
      });
    }
  }

  return issues;
}
