# Plan: TCO (Total Cost of Ownership) calculator for Atlas

*Status: proposed — awaiting approval. No implementation yet.*

## 1. Research: what a good TCO method looks like

Three practice families converge on the same shape:

**Gartner-lineage TCO** (the industry default since Kirwin's model): TCO is the
holistic cost of an asset across its lifecycle — direct spend *and* indirect costs —
assessed over a multi-year horizon (Gartner's application TCO tooling uses five years,
their benchmark metric one year). The key discipline is a **standard cost perimeter**:
a fixed taxonomy of cost categories applied identically to every asset, so numbers are
comparable across the portfolio.

**Application-portfolio rationalisation practice** (e.g. the US CIO Council playbook,
consulting playbooks): the load-bearing split is **run cost vs change cost** — the
recurring cost of operating what exists versus discretionary investment in changing it.
Run cost measures the burden of the current estate; comparing run cost against target
architectures is what turns TCO into a rationalisation and business-case tool
("expensive to run" vs "expensive to avoid").

**FinOps / cloud unit economics**: per-application TCO visualisation from tagged cloud
billing; cost tracked per unit (application, team, transaction) rather than a single
monthly bill. For Atlas this maps naturally onto cloud-service *components* — and
motivates a later billing-import integration rather than manual entry.

**Method chosen for Atlas** (synthesis): element-attached cost entries in a fixed
category taxonomy (perimeter), classified run/change, one-off costs amortised, rolled
up through the containment hierarchy, evaluated through Atlas's existing temporal
engine so *current vs target TCO* falls out of the state machinery we already have.
That last point is the differentiator: no rival tool ties TCO to a time-aware model.

Sources: [Gartner TCO definition](https://www.gartner.com/en/information-technology/glossary/total-cost-of-ownership-tco),
[Gartner TCO calculator (5-year application horizon)](https://www.gartner.com/en/documents/3769114),
[Defining Gartner TCO (Kirwin model)](https://barsand.wordpress.com/wp-content/uploads/2015/03/gartner_tco.pdf),
[Four Laws of Application TCO](https://www.gartner.com/doc/1972915/laws-application-total-cost-ownership),
[US CIO Council Application Rationalization Playbook](https://www.cio.gov/app-rat-playbook.pdf),
[Umbrex: cost & economic value in app rationalisation](https://umbrex.com/resources/application-portfolio-rationalization-playbook/understanding-cost-and-economic-value/),
[FinOps unit economics](https://www.finops.org/framework/capabilities/unit-economics/),
[FinOps.World: TCO per application](https://finops.world/en/practices/card/2r1-visualization-of-tco-per-application/),
[CloudZero: cloud TCO](https://www.cloudzero.com/blog/cloud-tco/).

## 2. The cost model (data design)

A new optional field on **Element** (any kind except group; groups roll up only):

```jsonc
"costs": [
  {
    "id": "<ulid>",
    "label": "Prod AWS bill",              // free text
    "category": "infrastructure",           // fixed taxonomy, below
    "classification": "run",                // run | change | acquire | retire
    "kind": "recurring",                    // recurring | one-off
    "amount": 4200,                         // in minor-unit-free currency units
    "currency": "GBP",                      // workspace default GBP; per-entry override
    "period": "monthly",                    // recurring: monthly | annual
    "amortiseYears": 3,                     // one-off only; default 3 (straight-line)
    "confidence": "estimate",               // estimate | quoted | actual
    "validFrom": "2026-01-01",              // optional — same semantics as element temporal
    "validTo": null,
    "states": []                            // optional named-state membership, as temporal.states
  }
]
```

**Category taxonomy (the perimeter — fixed, not user-extensible in v1):**
`licences`, `infrastructure` (cloud/hosting/hardware), `people` (run/support staff),
`vendor-services` (managed services, support contracts), `change` (projects,
enhancements), `decommission`, `other`. Consistency across the estate matters more
than per-team nuance; custom categories are a v2 decision.

**Calculation rules** (pure functions in `@atlas/core`, mirroring the temporal engine):

- **Annual run-rate** of an element at a temporal context = Σ recurring costs visible
  in that context (normalised to annual) classified `run`, **plus** amortised slice of
  one-off costs still inside their amortisation window.
- **N-year TCO** (default 5, per Gartner's application horizon) = Σ over years 1..N of
  the yearly figure evaluated at that year's date — so costs with `validTo`, state
  membership, and future `validFrom` (e.g. a target-state platform fee) do the right
  thing automatically.
- **Roll-up**: an element's *total* = own costs + Σ descendants (containment tree).
  Shown as own/rolled-up separately. Groups show rolled-up members.
- **Scenario delta**: TCO(state A) vs TCO(state B) reuses `diffContexts` machinery —
  the "Target 2028 saves £X/yr run-rate" figure is the headline output.
- Currency: single-currency maths in v1 (mixed currencies flagged, not converted).

## 3. Introduction plan (phases, each independently shippable)

**Phase 1 — Model + calculation core** (`@atlas/core`)
Add `costs[]` to Element; JSON Schema + serialiser (deterministic ordering by id);
`tco.ts` engine: `annualRunRate(ws, elementId, ctx)`, `tcoOverYears(ws, elementId, {years, ctx})`,
`estateTco(ws, ctx)` with roll-ups, `tcoDiff(ws, ctxA, ctxB)`.
DB: `costs jsonb` column migration + row mapping; API passes through automatically via
element CRUD. *Accept: unit tests — amortisation, temporal windows, state membership,
roll-up, diff; golden serialisation unchanged for cost-free workspaces.*

**Phase 2 — Capture UX** (inspector)
"Costs" section on the element inspector: entry list + add/edit rows (category,
classification, amount/period, one-off amortisation, confidence, validity/states —
reusing the TemporalEditor pattern). Everything through `updateElement`, so undo/API/AI
parity is free. *Accept: e2e — add a monthly licence + one-off build cost, values
persist and round-trip.*

**Phase 3 — TCO panel + canvas surfacing**
New "TCO" tab in the Analysis drawer: estate table (element, own, rolled-up run-rate,
5-yr TCO) sorted descending, with CSV export; per-element figure shown in the
inspector header; optional "cost" colour overlay on the canvas (reuse the tag-overlay
mechanism, bucketing by run-rate) so hot spots are visible on diagrams.
*Accept: e2e — seeded costs appear in the table; overlay highlights the most expensive
system; CSV downloads.*

**Phase 4 — Time and scenarios (the differentiator)**
Timeline-bar cost readout: current context's estate run-rate updates as you scrub;
compare mode's diff report gains a cost section ("run-rate: £X → £Y, Δ −£Z/yr;
5-yr TCO delta"). *Accept: e2e — retiring the mainframe in Target 2028 shows the
saving in the diff report.*

**Phase 5 — AI + API ergonomics**
AI tools: `set_costs` (per element) so "the mainframe costs £300k a year to run" works
conversationally; OpenAPI schema for `costs[]`; docs/api.md examples.
*Accept: stubbed-AI e2e queues cost changes; API PATCH with costs validated.*

**Phase 6 (later / v2)** — cloud billing import for components (FinOps path: map
tagged AWS/Azure/GCP cost exports onto component stencil attributes), custom
categories, currency conversion, cost-per-unit metrics.

Estimated effort: phases 1–2 one session; 3–5 one to two more. No breaking changes:
`costs` is optional everywhere, so existing workspaces, exports and the golden format
tests are untouched.

## 4. Out of scope (explicitly)

Chargeback/showback workflows, budget approvals, invoice reconciliation, multi-currency
FX, and automated billing ingestion (Phase 6 sketch only). Atlas states *what the
architecture costs*; it is not a finance system.
