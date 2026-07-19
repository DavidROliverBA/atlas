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
  /**
   * Currencies contributing to this row (own cost plus every descendant's),
   * sorted. `ownAnnual`/`rolledUpAnnual`/`tco` are a meaningful single figure
   * only when this has exactly one entry — the UI must not print a symbol
   * (or add these figures to another row's) when it has more than one.
   */
  currencies: string[];
}

/** Per-currency estate totals — the only trustworthy read when `currencies.length > 1`. */
export interface CurrencyTotals {
  totalAnnual: number;
  totalTco: number;
}

export interface EstateTco {
  rows: TcoRow[];
  /**
   * Sum across every currency, own costs counted once (never rolled-up
   * totals — that would double-count). When more than one currency is in
   * play this is an unlabelled sum of incompatible units — the UI must
   * never print it with a single currency symbol; use `byCurrency` instead.
   */
  totalAnnual: number;
  /** Same caveat as `totalAnnual`, over `years`. */
  totalTco: number;
  years: number;
  currencies: string[];
  /** Estate totals broken out per currency — always safe to print with its symbol. */
  byCurrency: Record<string, CurrencyTotals>;
}

export interface CurrencyDelta {
  annualA: number;
  annualB: number;
  annualDelta: number;
  tcoA: number;
  tcoB: number;
  tcoDelta: number;
}

export interface TcoDelta {
  annualA: number;
  annualB: number;
  annualDelta: number;
  tcoA: number;
  tcoB: number;
  tcoDelta: number;
  years: number;
  /** Same figures, broken out per currency — always safe to print with its symbol. */
  byCurrency: Record<string, CurrencyDelta>;
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

/** Every currency contributing to an element's own cost plus its descendants', sorted. */
function subtreeCurrencies(ws: Workspace, id: Ulid, ctx: TemporalContext): string[] {
  const out = new Set<string>();
  const walk = (elId: Ulid) => {
    for (const cost of ws.element(elId).costs ?? []) {
      if (costEntryVisible(ws, cost, ctx)) out.add(cost.currency ?? "GBP");
    }
    for (const child of ws.children(elId)) walk(child.id);
  };
  walk(id);
  return [...out].sort();
}

/** Own-cost annual run-rate across `ids`, summed once per element and broken out by currency. */
function costsByCurrency(ws: Workspace, ids: Iterable<Ulid>, ctx: TemporalContext): Map<string, number> {
  const map = new Map<string, number>();
  const atDate = ctx.type === "date" ? ctx.date : undefined;
  for (const id of ids) {
    for (const cost of ws.element(id).costs ?? []) {
      if (!costEntryVisible(ws, cost, ctx)) continue;
      const currency = cost.currency ?? "GBP";
      map.set(currency, (map.get(currency) ?? 0) + annualisedAmount(cost, atDate));
    }
  }
  return map;
}

/** N-year TCO across `ids`, broken out by currency (re-evaluating per year for a date context). */
function tcoByCurrencyOverYears(
  ws: Workspace,
  ids: Ulid[],
  ctx: TemporalContext,
  years: number,
): { total: number; byCurrency: Map<string, number> } {
  const byCurrency = new Map<string, number>();
  let total = 0;
  if (ctx.type !== "date") {
    for (const [currency, amount] of costsByCurrency(ws, ids, ctx)) {
      byCurrency.set(currency, amount * years);
      total += amount * years;
    }
    return { total, byCurrency };
  }
  for (let offset = 0; offset < years; offset++) {
    const stepped: TemporalContext = { type: "date", date: addYearsIso(ctx.date, offset) };
    for (const [currency, amount] of costsByCurrency(ws, ids, stepped)) {
      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
      total += amount;
    }
  }
  return { total, byCurrency };
}

function toByCurrencyRecord(
  annualByCurrency: Map<string, number>,
  tcoByCurrency: Map<string, number>,
): Record<string, CurrencyTotals> {
  const currencies = new Set([...annualByCurrency.keys(), ...tcoByCurrency.keys()]);
  const out: Record<string, CurrencyTotals> = {};
  for (const currency of currencies) {
    out[currency] = {
      totalAnnual: annualByCurrency.get(currency) ?? 0,
      totalTco: tcoByCurrency.get(currency) ?? 0,
    };
  }
  return out;
}

/** Estate-wide TCO: per-element run-rate and N-year cost, plus estate totals (own costs summed once, never rolled-up totals — that would double-count). */
export function estateTco(ws: Workspace, ctx: TemporalContext, years = 5): EstateTco {
  const rows: TcoRow[] = [];
  let totalAnnual = 0;

  for (const el of ws.elements.values()) {
    const { own, rolledUp } = elementAnnual(ws, el.id, ctx);
    totalAnnual += own;
    if (rolledUp > 0) {
      const tco =
        ctx.type === "date"
          ? sumRange(years, (offset) => annualAtYearOffset(ws, el.id, ctx, offset).rolledUp)
          : rolledUp * years;
      rows.push({
        id: el.id,
        name: el.name,
        kind: el.kind,
        ownAnnual: own,
        rolledUpAnnual: rolledUp,
        tco,
        currencies: subtreeCurrencies(ws, el.id, ctx),
      });
    }
  }
  rows.sort((a, b) => b.rolledUpAnnual - a.rolledUpAnnual);

  const ids = [...ws.elements.keys()];
  const annualByCurrency = costsByCurrency(ws, ids, ctx);
  const { total: totalTco, byCurrency: tcoByCurrency } = tcoByCurrencyOverYears(ws, ids, ctx, years);
  const byCurrency = toByCurrencyRecord(annualByCurrency, tcoByCurrency);
  const currencies = Object.keys(byCurrency).sort();

  return { rows, totalAnnual, totalTco, years, currencies, byCurrency };
}

/**
 * TCO for one element and its containment subtree only: rows cover the root
 * plus every descendant, and totals are the root's rolled-up figures (not
 * the whole estate's) — the per-scope view in the Analysis drawer.
 */
export function subtreeTco(ws: Workspace, rootId: Ulid, ctx: TemporalContext, years = 5): EstateTco {
  const ids: Ulid[] = [];
  const collect = (id: Ulid) => {
    ids.push(id);
    for (const child of ws.children(id)) collect(child.id);
  };
  collect(rootId);

  const rows: TcoRow[] = [];
  for (const id of ids) {
    const el = ws.element(id);
    const { own, rolledUp } = elementAnnual(ws, id, ctx);
    if (rolledUp > 0) {
      const tco =
        ctx.type === "date"
          ? sumRange(years, (offset) => annualAtYearOffset(ws, id, ctx, offset).rolledUp)
          : rolledUp * years;
      rows.push({
        id,
        name: el.name,
        kind: el.kind,
        ownAnnual: own,
        rolledUpAnnual: rolledUp,
        tco,
        currencies: subtreeCurrencies(ws, id, ctx),
      });
    }
  }
  rows.sort((a, b) => b.rolledUpAnnual - a.rolledUpAnnual);

  const totalAnnual = elementAnnual(ws, rootId, ctx).rolledUp;
  const totalTco =
    ctx.type === "date"
      ? sumRange(years, (offset) => annualAtYearOffset(ws, rootId, ctx, offset).rolledUp)
      : totalAnnual * years;

  const annualByCurrency = costsByCurrency(ws, ids, ctx);
  const { byCurrency: tcoByCurrency } = tcoByCurrencyOverYears(ws, ids, ctx, years);
  const byCurrency = toByCurrencyRecord(annualByCurrency, tcoByCurrency);
  const currencies = Object.keys(byCurrency).sort();

  return { rows, totalAnnual, totalTco, years, currencies, byCurrency };
}

/** Scenario delta: estate TCO under context B minus context A (e.g. "Target 2028" vs "Current"). */
export function tcoDiff(ws: Workspace, ctxA: TemporalContext, ctxB: TemporalContext, years = 5): TcoDelta {
  const a = estateTco(ws, ctxA, years);
  const b = estateTco(ws, ctxB, years);

  const currencies = new Set([...Object.keys(a.byCurrency), ...Object.keys(b.byCurrency)]);
  const byCurrency: Record<string, CurrencyDelta> = {};
  for (const currency of currencies) {
    const av = a.byCurrency[currency] ?? { totalAnnual: 0, totalTco: 0 };
    const bv = b.byCurrency[currency] ?? { totalAnnual: 0, totalTco: 0 };
    byCurrency[currency] = {
      annualA: av.totalAnnual,
      annualB: bv.totalAnnual,
      annualDelta: bv.totalAnnual - av.totalAnnual,
      tcoA: av.totalTco,
      tcoB: bv.totalTco,
      tcoDelta: bv.totalTco - av.totalTco,
    };
  }

  return {
    annualA: a.totalAnnual,
    annualB: b.totalAnnual,
    annualDelta: b.totalAnnual - a.totalAnnual,
    tcoA: a.totalTco,
    tcoB: b.totalTco,
    tcoDelta: b.totalTco - a.totalTco,
    years,
    byCurrency,
  };
}
