/**
 * TCO (total cost of ownership) engine (docs/tco-plan.md §2): roll cost
 * entries up through the containment hierarchy and evaluate them through the
 * temporal engine, so current-vs-target TCO falls out of the same state
 * machinery as the rest of the model.
 */

import type { Ulid } from "../ids.js";
import type { CostEntry, ElementKind, IsoDate } from "../metamodel/types.js";
import type { Workspace } from "../model/workspace.js";
import { isVisible, type TemporalContext } from "../temporal/engine.js";

export interface TcoRow {
  id: Ulid;
  name: string;
  kind: ElementKind;
  ownAnnual: number;
  rolledUpAnnual: number;
  tco: number;
}

export interface EstateTco {
  rows: TcoRow[];
  totalAnnual: number;
  totalTco: number;
  years: number;
  currencies: string[];
}

export interface TcoDelta {
  annualA: number;
  annualB: number;
  annualDelta: number;
  tcoA: number;
  tcoB: number;
  tcoDelta: number;
  years: number;
}

/** Same visibility rules as the temporal engine, applied to a cost entry's own validity. */
export function costEntryVisible(ws: Workspace, entry: CostEntry, ctx: TemporalContext): boolean {
  return isVisible(ws, { validFrom: entry.validFrom, validTo: entry.validTo, states: entry.states }, ctx);
}

/** Add whole years to an ISO date by string maths on the year segment (date-grained, no calendar library needed). */
function addYearsIso(date: IsoDate, years: number): IsoDate {
  const year = Number(date.slice(0, 4));
  return `${year + years}${date.slice(4)}`;
}

/**
 * Annual run-rate contribution of a single cost entry.
 * Recurring costs normalise to an annual figure. One-off costs amortise
 * straight-line over `amortiseYears` (default 3); when an evaluation date is
 * given and the entry has a `validFrom`, the slice only counts inside the
 * amortisation window — otherwise it always counts (state/"all" contexts,
 * or a one-off with no start date, have no window to fall outside of).
 */
export function annualisedAmount(entry: CostEntry, atDate?: IsoDate): number {
  if (entry.kind === "recurring") {
    return entry.period === "monthly" ? entry.amount * 12 : entry.amount;
  }
  const years = entry.amortiseYears ?? 3;
  const slice = entry.amount / years;
  if (atDate && entry.validFrom) {
    const windowEnd = addYearsIso(entry.validFrom, years);
    if (atDate < entry.validFrom || atDate >= windowEnd) return 0;
  }
  return slice;
}

/** An element's own annual run-rate, and that total rolled up through its containment descendants. */
export function elementAnnual(ws: Workspace, id: Ulid, ctx: TemporalContext): { own: number; rolledUp: number } {
  const el = ws.element(id);
  const atDate = ctx.type === "date" ? ctx.date : undefined;
  const own = (el.costs ?? [])
    .filter((c) => costEntryVisible(ws, c, ctx))
    .reduce((sum, c) => sum + annualisedAmount(c, atDate), 0);
  const rolledUp = ws.children(id).reduce((sum, child) => sum + elementAnnual(ws, child.id, ctx).rolledUp, own);
  return { own, rolledUp };
}

/** `elementAnnual` re-evaluated `offset` years after a date context (unchanged for state/"all" contexts). */
export function annualAtYearOffset(
  ws: Workspace,
  id: Ulid,
  ctx: TemporalContext,
  offset: number,
): { own: number; rolledUp: number } {
  const stepped: TemporalContext = ctx.type === "date" ? { type: "date", date: addYearsIso(ctx.date, offset) } : ctx;
  return elementAnnual(ws, id, stepped);
}

function sumRange(years: number, atOffset: (offset: number) => number): number {
  let total = 0;
  for (let offset = 0; offset < years; offset++) total += atOffset(offset);
  return total;
}

/** Estate-wide TCO: per-element run-rate and N-year cost, plus estate totals (own costs summed once, never rolled-up totals — that would double-count). */
export function estateTco(ws: Workspace, ctx: TemporalContext, years = 5): EstateTco {
  const rows: TcoRow[] = [];
  const currencies = new Set<string>();
  let totalAnnual = 0;

  for (const el of ws.elements.values()) {
    const { own, rolledUp } = elementAnnual(ws, el.id, ctx);
    totalAnnual += own;
    for (const cost of el.costs ?? []) {
      if (costEntryVisible(ws, cost, ctx)) currencies.add(cost.currency ?? "GBP");
    }
    if (rolledUp > 0) {
      const tco =
        ctx.type === "date"
          ? sumRange(years, (offset) => annualAtYearOffset(ws, el.id, ctx, offset).rolledUp)
          : rolledUp * years;
      rows.push({ id: el.id, name: el.name, kind: el.kind, ownAnnual: own, rolledUpAnnual: rolledUp, tco });
    }
  }
  rows.sort((a, b) => b.rolledUpAnnual - a.rolledUpAnnual);

  const totalTco =
    ctx.type === "date"
      ? sumRange(years, (offset) => {
          let yearOwn = 0;
          for (const el of ws.elements.values()) yearOwn += annualAtYearOffset(ws, el.id, ctx, offset).own;
          return yearOwn;
        })
      : totalAnnual * years;

  return { rows, totalAnnual, totalTco, years, currencies: [...currencies].sort() };
}

/** Scenario delta: estate TCO under context B minus context A (e.g. "Target 2028" vs "Current"). */
export function tcoDiff(ws: Workspace, ctxA: TemporalContext, ctxB: TemporalContext, years = 5): TcoDelta {
  const a = estateTco(ws, ctxA, years);
  const b = estateTco(ws, ctxB, years);
  return {
    annualA: a.totalAnnual,
    annualB: b.totalAnnual,
    annualDelta: b.totalAnnual - a.totalAnnual,
    tcoA: a.totalTco,
    tcoB: b.totalTco,
    tcoDelta: b.totalTco - a.totalTco,
    years,
  };
}
