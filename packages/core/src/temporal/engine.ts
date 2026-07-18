/**
 * Temporal engine (§3.6): evaluate which model objects exist in a given
 * temporal context (a date, or a named state), apply per-state attribute
 * overrides, and diff two contexts.
 */

import type { Ulid } from "../ids.js";
import type { Element, IsoDate, Relationship, Temporal } from "../metamodel/types.js";
import type { Workspace } from "../model/workspace.js";

/** "Now" with no filter, a specific date, or a named state. */
export type TemporalContext =
  | { type: "all" }
  | { type: "date"; date: IsoDate }
  | { type: "state"; stateId: Ulid };

function withinDates(t: Temporal | undefined, date: IsoDate): boolean {
  if (!t) return true;
  if (t.validFrom && date < t.validFrom) return false;
  if (t.validTo && date > t.validTo) return false;
  return true;
}

/**
 * Visibility rules:
 * - No temporal data → always visible.
 * - Date context → the date must fall within [validFrom, validTo].
 * - State context → explicit membership wins when the object lists states;
 *   otherwise fall back to the state's anchor date (if it has one);
 *   otherwise visible.
 */
export function isVisible(
  ws: Workspace,
  temporal: Temporal | undefined,
  ctx: TemporalContext,
): boolean {
  if (ctx.type === "all" || !temporal) return true;
  if (ctx.type === "date") return withinDates(temporal, ctx.date);
  const state = ws.state(ctx.stateId);
  if (temporal.states && temporal.states.length > 0) {
    return temporal.states.includes(ctx.stateId);
  }
  if (state.date) return withinDates(temporal, state.date);
  return true;
}

/** Element ids visible in a context. */
export function visibleElements(ws: Workspace, ctx: TemporalContext): Set<Ulid> {
  const out = new Set<Ulid>();
  for (const e of ws.elements.values()) {
    if (isVisible(ws, e.temporal, ctx)) out.add(e.id);
  }
  // An element cannot outlive its ancestors: hide anything with a hidden ancestor.
  for (const id of [...out]) {
    for (const ancestor of ws.ancestors(id)) {
      if (!out.has(ancestor.id)) {
        out.delete(id);
        break;
      }
    }
  }
  return out;
}

/** Relationship ids visible in a context (both endpoints must also be visible). */
export function visibleRelationships(
  ws: Workspace,
  ctx: TemporalContext,
  elementIds = visibleElements(ws, ctx),
): Set<Ulid> {
  const out = new Set<Ulid>();
  for (const r of ws.relationships.values()) {
    if (
      isVisible(ws, r.temporal, ctx) &&
      elementIds.has(r.sourceId) &&
      elementIds.has(r.targetId)
    ) {
      out.add(r.id);
    }
  }
  return out;
}

/** An element with its per-state attribute overrides applied. */
export function effectiveElement(element: Element, ctx: TemporalContext): Element {
  if (ctx.type !== "state") return element;
  const override = element.stateOverrides?.[ctx.stateId];
  if (!override) return element;
  return { ...element, ...override };
}

export interface AttributeChange {
  attribute: string;
  from: unknown;
  to: unknown;
}

export interface StateDiff {
  addedElements: Ulid[];
  removedElements: Ulid[];
  changedElements: Array<{ id: Ulid; changes: AttributeChange[] }>;
  addedRelationships: Ulid[];
  removedRelationships: Ulid[];
}

const DIFFED_ATTRIBUTES: ReadonlyArray<keyof Element> = [
  "name",
  "description",
  "technology",
  "status",
  "tags",
];

/**
 * Diff two temporal contexts: which elements/relationships appear, retire,
 * or change attributes between them (added = green, removed = red,
 * changed = amber in the UI overlay).
 */
export function diffContexts(ws: Workspace, a: TemporalContext, b: TemporalContext): StateDiff {
  const elemsA = visibleElements(ws, a);
  const elemsB = visibleElements(ws, b);
  const relsA = visibleRelationships(ws, a, elemsA);
  const relsB = visibleRelationships(ws, b, elemsB);

  const sortedIds = (s: Set<Ulid>) => [...s].sort();
  const diff: StateDiff = {
    addedElements: sortedIds(elemsB).filter((id) => !elemsA.has(id)),
    removedElements: sortedIds(elemsA).filter((id) => !elemsB.has(id)),
    changedElements: [],
    addedRelationships: sortedIds(relsB).filter((id) => !relsA.has(id)),
    removedRelationships: sortedIds(relsA).filter((id) => !relsB.has(id)),
  };

  for (const id of sortedIds(elemsA)) {
    if (!elemsB.has(id)) continue;
    const el = ws.element(id);
    const ea = effectiveElement(el, a);
    const eb = effectiveElement(el, b);
    const changes: AttributeChange[] = [];
    for (const attr of DIFFED_ATTRIBUTES) {
      const va = ea[attr];
      const vb = eb[attr];
      if (JSON.stringify(va ?? null) !== JSON.stringify(vb ?? null)) {
        changes.push({ attribute: attr, from: va, to: vb });
      }
    }
    if (changes.length) diff.changedElements.push({ id, changes });
  }
  return diff;
}

/** Human-readable change report for a diff (used by the state-diff panel and CLI). */
export function diffReport(ws: Workspace, diff: StateDiff): string {
  const name = (id: Ulid) => ws.elements.get(id)?.name ?? id;
  const relLabel = (id: Ulid) => {
    const r = ws.relationships.get(id);
    if (!r) return id;
    return `${name(r.sourceId)} → ${name(r.targetId)}${r.name ? ` (${r.name})` : ""}`;
  };
  const lines: string[] = [];
  for (const id of diff.addedElements) lines.push(`+ ${name(id)}`);
  for (const id of diff.removedElements) lines.push(`- ${name(id)}`);
  for (const { id, changes } of diff.changedElements) {
    for (const c of changes) {
      lines.push(
        `~ ${name(id)}: ${c.attribute} ${JSON.stringify(c.from ?? null)} → ${JSON.stringify(c.to ?? null)}`,
      );
    }
  }
  for (const id of diff.addedRelationships) lines.push(`+ ${relLabel(id)}`);
  for (const id of diff.removedRelationships) lines.push(`- ${relLabel(id)}`);
  return lines.length ? lines.join("\n") : "No differences.";
}
