import { describe, expect, it } from "vitest";
import { buildFixture } from "./fixture.js";
import {
  annualisedAmount,
  costEntryVisible,
  elementAnnual,
  estateTco,
  subtreeTco,
  tcoDiff,
} from "../src/analysis/tco.js";
import { workspaceFromFiles, workspaceToFiles } from "../src/serialize/files.js";
import type { CostEntry } from "../src/metamodel/types.js";

describe("TCO engine", () => {
  it("normalises recurring costs to an annual figure", () => {
    const monthly: CostEntry = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      label: "SaaS licence",
      category: "licences",
      classification: "run",
      kind: "recurring",
      amount: 500,
      period: "monthly",
    };
    expect(annualisedAmount(monthly)).toBe(6000);
    expect(annualisedAmount({ ...monthly, period: "annual" })).toBe(500);
    expect(annualisedAmount({ ...monthly, period: undefined })).toBe(500); // default is annual
  });

  it("amortises one-off costs straight-line over 3 years by default", () => {
    const oneOff: CostEntry = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      label: "Migration project",
      category: "change",
      classification: "acquire",
      kind: "one-off",
      amount: 90000,
    };
    expect(annualisedAmount(oneOff)).toBe(30000);
    expect(annualisedAmount({ ...oneOff, amortiseYears: 5 })).toBe(18000);
  });

  it("windows a one-off cost to its amortisation period once a date and validFrom are known", () => {
    const oneOff: CostEntry = {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      label: "Platform build",
      category: "change",
      classification: "acquire",
      kind: "one-off",
      amount: 60000,
      amortiseYears: 3,
      validFrom: "2026-01-01",
    };
    expect(annualisedAmount(oneOff, "2026-06-01")).toBe(20000); // inside the window
    expect(annualisedAmount(oneOff, "2028-12-31")).toBe(20000); // still inside (< 2029-01-01)
    expect(annualisedAmount(oneOff, "2029-01-01")).toBe(0); // window has ended
    expect(annualisedAmount(oneOff, "2025-12-31")).toBe(0); // before validFrom
    expect(annualisedAmount(oneOff)).toBe(20000); // no date given: the slice always counts
  });

  it("a cost entry's validTo excludes it from a later date context", () => {
    const f = buildFixture();
    const cost: CostEntry = {
      id: f.ids.next(),
      label: "Mainframe support contract",
      category: "vendor-services",
      classification: "run",
      kind: "recurring",
      amount: 300000,
      validTo: "2027-12-31",
    };
    f.bus.dispatch({ type: "updateElement", id: f.mainframe.id, changes: { costs: [cost] } });

    expect(costEntryVisible(f.ws, cost, { type: "date", date: "2026-07-18" })).toBe(true);
    expect(costEntryVisible(f.ws, cost, { type: "date", date: "2028-06-01" })).toBe(false);
    expect(elementAnnual(f.ws, f.mainframe.id, { type: "date", date: "2028-06-01" }).own).toBe(0);
  });

  it("explicit state membership pins a cost entry into a state and excludes it elsewhere", () => {
    const f = buildFixture();
    const cost: CostEntry = {
      id: f.ids.next(),
      label: "Target platform fee",
      category: "infrastructure",
      classification: "run",
      kind: "recurring",
      amount: 12000,
      states: [f.target.id],
    };
    f.bus.dispatch({ type: "updateElement", id: f.payments.id, changes: { costs: [cost] } });

    expect(costEntryVisible(f.ws, cost, { type: "state", stateId: f.target.id })).toBe(true);
    expect(costEntryVisible(f.ws, cost, { type: "state", stateId: f.current.id })).toBe(false);
  });

  it("rolls an element's own cost up through its containment descendants", () => {
    const f = buildFixture();
    const bookingCost: CostEntry = {
      id: f.ids.next(),
      label: "Booking support team",
      category: "people",
      classification: "run",
      kind: "recurring",
      amount: 400000,
    };
    const webAppCost: CostEntry = {
      id: f.ids.next(),
      label: "Web hosting",
      category: "infrastructure",
      classification: "run",
      kind: "recurring",
      amount: 1000,
      period: "monthly",
    };
    const dbCost: CostEntry = {
      id: f.ids.next(),
      label: "DB licence",
      category: "licences",
      classification: "run",
      kind: "recurring",
      amount: 50000,
    };
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { costs: [bookingCost] } });
    f.bus.dispatch({ type: "updateElement", id: f.webApp.id, changes: { costs: [webAppCost] } });
    f.bus.dispatch({ type: "updateElement", id: f.bookingDb.id, changes: { costs: [dbCost] } });

    const ctx = { type: "all" } as const;
    const webApp = elementAnnual(f.ws, f.webApp.id, ctx);
    const bookingDb = elementAnnual(f.ws, f.bookingDb.id, ctx);
    const booking = elementAnnual(f.ws, f.booking.id, ctx);

    expect(webApp.rolledUp).toBe(12000);
    expect(bookingDb.rolledUp).toBe(50000);
    expect(booking.own).toBe(400000);
    expect(booking.rolledUp).toBe(booking.own + webApp.rolledUp + bookingDb.rolledUp);
  });

  it("estate totals sum own costs once and rows sort by rolled-up run-rate descending", () => {
    const f = buildFixture();
    const bookingCost: CostEntry = {
      id: f.ids.next(),
      label: "Booking support team",
      category: "people",
      classification: "run",
      kind: "recurring",
      amount: 400000,
    };
    const webAppCost: CostEntry = {
      id: f.ids.next(),
      label: "Web hosting",
      category: "infrastructure",
      classification: "run",
      kind: "recurring",
      amount: 1000,
      period: "monthly",
    };
    const paymentsCost: CostEntry = {
      id: f.ids.next(),
      label: "Payments platform",
      category: "vendor-services",
      classification: "run",
      kind: "recurring",
      amount: 20000,
    };
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { costs: [bookingCost] } });
    f.bus.dispatch({ type: "updateElement", id: f.webApp.id, changes: { costs: [webAppCost] } });
    f.bus.dispatch({ type: "updateElement", id: f.payments.id, changes: { costs: [paymentsCost] } });

    const estate = estateTco(f.ws, { type: "all" });
    // Booking rolls up to 400000 + 12000 (Web App); summing rolled-up totals across rows instead of
    // own costs would double-count Web App's cost once directly and once inside Booking's row.
    expect(estate.totalAnnual).toBe(432000);
    for (let i = 1; i < estate.rows.length; i++) {
      expect(estate.rows[i - 1]!.rolledUpAnnual).toBeGreaterThanOrEqual(estate.rows[i]!.rolledUpAnnual);
    }
    const bookingRow = estate.rows.find((r) => r.id === f.booking.id)!;
    expect(bookingRow.ownAnnual).toBe(400000);
    expect(bookingRow.rolledUpAnnual).toBe(412000);
  });

  it("collects currency codes across visible entries, defaulting to GBP", () => {
    const f = buildFixture();
    const gbpCost: CostEntry = {
      id: f.ids.next(),
      label: "UK hosting",
      category: "infrastructure",
      classification: "run",
      kind: "recurring",
      amount: 5000,
    };
    const usdCost: CostEntry = {
      id: f.ids.next(),
      label: "US SaaS",
      category: "licences",
      classification: "run",
      kind: "recurring",
      amount: 8000,
      currency: "USD",
    };
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { costs: [gbpCost] } });
    f.bus.dispatch({ type: "updateElement", id: f.payments.id, changes: { costs: [usdCost] } });

    const estate = estateTco(f.ws, { type: "all" });
    expect(estate.currencies).toEqual(["GBP", "USD"]);
  });

  it("tcoDiff shows a retired element's run-rate disappearing from current to target", () => {
    const f = buildFixture();
    const mainframeCost: CostEntry = {
      id: f.ids.next(),
      label: "Mainframe run cost",
      category: "infrastructure",
      classification: "run",
      kind: "recurring",
      amount: 300000,
      // Entry visibility uses the entry's own temporal fields, not the element's — mirror the
      // mainframe element's validTo here so the cost actually retires alongside it.
      validTo: "2027-12-31",
    };
    f.bus.dispatch({ type: "updateElement", id: f.mainframe.id, changes: { costs: [mainframeCost] } });

    const delta = tcoDiff(
      f.ws,
      { type: "state", stateId: f.current.id },
      { type: "state", stateId: f.target.id },
    );
    expect(delta.annualA).toBe(300000);
    expect(delta.annualB).toBe(0);
    expect(delta.annualDelta).toBe(-300000);
    expect(delta.tcoDelta).toBeLessThan(0);

    const targetEstate = estateTco(f.ws, { type: "state", stateId: f.target.id });
    expect(targetEstate.rows.some((r) => r.id === f.mainframe.id)).toBe(false);
  });

  it("the command bus rejects invalid cost entries before they reach the workspace", () => {
    const f = buildFixture();
    const base: CostEntry = {
      id: f.ids.next(),
      label: "Bad",
      category: "other",
      classification: "run",
      kind: "recurring",
      amount: 100,
    };
    expect(() =>
      f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { costs: [{ ...base, amount: -1 }] } }),
    ).toThrow(/greater than zero/);
    expect(() =>
      f.bus.dispatch({
        type: "updateElement",
        id: f.booking.id,
        changes: { costs: [{ ...base, states: ["01ARZ3NDEKTSV4RRFFQ69G5FAV"] }] },
      }),
    ).toThrow(/Unknown state/);
    expect(() =>
      f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { costs: [base, base] } }),
    ).toThrow(/Duplicate cost entry id/);
  });

  it("rejects a non-positive amount or an unknown category at the schema", () => {
    const f = buildFixture();
    const cost: CostEntry = {
      id: f.ids.next(),
      label: "Support",
      category: "other",
      classification: "run",
      kind: "recurring",
      amount: 100,
    };
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { costs: [cost] } });
    const path = [...workspaceToFiles(f.ws).keys()].find((p) => p.includes(f.booking.id))!;

    const badAmount = workspaceToFiles(f.ws);
    const parsedAmount = JSON.parse(badAmount.get(path)!);
    parsedAmount.costs[0].amount = 0;
    badAmount.set(path, JSON.stringify(parsedAmount));
    expect(() => workspaceFromFiles(badAmount)).toThrow(/Schema validation/);

    const badCategory = workspaceToFiles(f.ws);
    const parsedCategory = JSON.parse(badCategory.get(path)!);
    parsedCategory.costs[0].category = "banana";
    badCategory.set(path, JSON.stringify(parsedCategory));
    expect(() => workspaceFromFiles(badCategory)).toThrow(/Schema validation/);
  });

  it("mixed-currency estates never collapse into one figure: byCurrency carries the trustworthy per-currency totals", () => {
    const f = buildFixture();
    const bookingCost: CostEntry = {
      id: f.ids.next(),
      label: "Booking support team",
      category: "people",
      classification: "run",
      kind: "recurring",
      amount: 400000,
      currency: "GBP",
    };
    const webAppCost: CostEntry = {
      id: f.ids.next(),
      label: "US CDN",
      category: "infrastructure",
      classification: "run",
      kind: "recurring",
      amount: 12000,
      currency: "USD",
    };
    const paymentsCost: CostEntry = {
      id: f.ids.next(),
      label: "US processor fee",
      category: "vendor-services",
      classification: "run",
      kind: "recurring",
      amount: 8000,
      currency: "USD",
    };
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { costs: [bookingCost] } });
    f.bus.dispatch({ type: "updateElement", id: f.webApp.id, changes: { costs: [webAppCost] } });
    f.bus.dispatch({ type: "updateElement", id: f.payments.id, changes: { costs: [paymentsCost] } });

    const estate = estateTco(f.ws, { type: "all" }, 5);
    expect(estate.currencies).toEqual(["GBP", "USD"]);
    expect(estate.byCurrency["GBP"]).toEqual({ totalAnnual: 400000, totalTco: 2000000 });
    expect(estate.byCurrency["USD"]).toEqual({ totalAnnual: 20000, totalTco: 100000 });
    // The raw totals still sum every currency (never NaN — hostile), but the UI must not label them.
    expect(estate.totalAnnual).toBe(420000);

    // Booking Engine's row spans both currencies (its own GBP cost plus Web App's USD cost rolled up).
    const bookingRow = estate.rows.find((r) => r.id === f.booking.id)!;
    expect(bookingRow.currencies).toEqual(["GBP", "USD"]);
    // Payments only ever carries USD.
    const paymentsRow = estate.rows.find((r) => r.id === f.payments.id)!;
    expect(paymentsRow.currencies).toEqual(["USD"]);
  });

  it("tcoDiff breaks the delta out per currency too", () => {
    const f = buildFixture();
    const mainframeCost: CostEntry = {
      id: f.ids.next(),
      label: "Mainframe run cost",
      category: "infrastructure",
      classification: "run",
      kind: "recurring",
      amount: 300000,
      validTo: "2027-12-31",
    };
    f.bus.dispatch({ type: "updateElement", id: f.mainframe.id, changes: { costs: [mainframeCost] } });

    const delta = tcoDiff(
      f.ws,
      { type: "state", stateId: f.current.id },
      { type: "state", stateId: f.target.id },
    );
    expect(delta.tcoA).toBe(1500000); // 300000/yr × 5 years, state contexts don't re-evaluate per year
    expect(delta.byCurrency["GBP"]).toEqual({
      annualA: 300000,
      annualB: 0,
      annualDelta: -300000,
      tcoA: 1500000,
      tcoB: 0,
      tcoDelta: -1500000,
    });
  });

  it("subtreeTco scopes rows and totals to one element's containment subtree", () => {
    const f = buildFixture();
    const bookingCost: CostEntry = {
      id: f.ids.next(),
      label: "Booking support team",
      category: "people",
      classification: "run",
      kind: "recurring",
      amount: 400000,
    };
    const webAppCost: CostEntry = {
      id: f.ids.next(),
      label: "Web hosting",
      category: "infrastructure",
      classification: "run",
      kind: "recurring",
      amount: 1000,
      period: "monthly",
    };
    const paymentsCost: CostEntry = {
      id: f.ids.next(),
      label: "Payments platform",
      category: "vendor-services",
      classification: "run",
      kind: "recurring",
      amount: 20000,
    };
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { costs: [bookingCost] } });
    f.bus.dispatch({ type: "updateElement", id: f.webApp.id, changes: { costs: [webAppCost] } });
    // Outside the subtree: must not leak into the scoped totals or rows.
    f.bus.dispatch({ type: "updateElement", id: f.payments.id, changes: { costs: [paymentsCost] } });

    const ctx = { type: "all" } as const;
    const scoped = subtreeTco(f.ws, f.booking.id, ctx, 5);

    expect(scoped.rows.map((r) => r.id).sort()).toEqual([f.booking.id, f.webApp.id].sort());
    expect(scoped.rows.some((r) => r.id === f.payments.id)).toBe(false);
    expect(scoped.totalAnnual).toBe(412000); // Booking's rolled-up figure, not the whole estate's
    expect(scoped.totalTco).toBe(412000 * 5);
    expect(scoped.byCurrency["GBP"]).toEqual({ totalAnnual: 412000, totalTco: 412000 * 5 });

    const estate = estateTco(f.ws, ctx, 5);
    expect(scoped.totalAnnual).toBeLessThan(estate.totalAnnual);
  });

  it("round-trips element costs byte-identically", () => {
    const f = buildFixture();
    const cost: CostEntry = {
      id: f.ids.next(),
      label: "Support contract",
      category: "vendor-services",
      classification: "run",
      kind: "recurring",
      amount: 24000,
      currency: "GBP",
      period: "monthly",
      confidence: "quoted",
      validFrom: "2026-01-01",
      states: [f.current.id],
    };
    f.bus.dispatch({ type: "updateElement", id: f.booking.id, changes: { costs: [cost] } });

    const files = workspaceToFiles(f.ws);
    const loaded = workspaceFromFiles(files);
    expect([...workspaceToFiles(loaded).entries()]).toEqual([...files.entries()]);
    expect(loaded.element(f.booking.id).costs).toEqual([cost]);
  });
});
