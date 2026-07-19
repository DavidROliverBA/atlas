/**
 * Estate analysis (§3.5): orphan and consistency reports, dependency matrix,
 * and downstream impact — list/tree projections of the model graph.
 */

import { useMemo, useState } from "react";
import {
  dependencyMatrix,
  downstreamOf,
  estateTco,
  lintWorkspace,
  subtreeTco,
  type EstateTco,
  type LintIssue,
  type LintSeverity,
  type TcoRow,
  type Ulid,
} from "@atlas/core";
import { motion } from "framer-motion";
import { useAtlas } from "../store";

const TCO_YEAR_OPTIONS = [1, 3, 5, 10] as const;

/** Errors first, then warnings, then info; stable within each group. */
const SEVERITY_RANK: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Severity-coloured chip classes, matched to the app's existing red/amber/slate vocabulary. */
const SEVERITY_CLASSES: Record<LintSeverity, string> = {
  error: "border-red-300 bg-red-50 text-red-800 hover:bg-red-100",
  warning: "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100",
  info: "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
};

/** Currency-formatted money, en-GB conventions (§CLAUDE.md default currency is GBP). */
function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

/** Plain grouped number, used when currencies are mixed and a symbol would mislead. */
function formatPlain(amount: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(amount);
}

/** Escape a CSV field: quote and double-up embedded quotes only when needed. */
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadTcoCsv(rows: TcoRow[], years: number): void {
  const header = `element,kind,own_annual,rolled_up_annual,tco_${years}yr`;
  const lines = rows.map(
    (r) => `${csvField(r.name)},${r.kind},${r.ownAnnual},${r.rolledUpAnnual},${r.tco}`,
  );
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "atlas-tco.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** One totals line per currency, e.g. "£1,200,000/yr + $340,000/yr" — never a meaningless mixed sum. */
function formatTotalsByCurrency(tco: EstateTco, suffix: string): string {
  return tco.currencies
    .map((c) => `${formatMoney(suffix === "/yr" ? tco.byCurrency[c]!.totalAnnual : tco.byCurrency[c]!.totalTco, c)}${suffix}`)
    .join(" + ");
}

/** Stable key identifying a lint issue across renders, for the click-to-cycle-ids behaviour. */
function issueKey(issue: LintIssue): string {
  return `${issue.code}:${issue.ids.join(",")}`;
}

export function AnalysisDrawer({ onClose }: { onClose: () => void }) {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const select = useAtlas((s) => s.select);
  const temporal = useAtlas((s) => s.temporal);
  const costOverlay = useAtlas((s) => s.costOverlay);
  const [impactRoot, setImpactRoot] = useState<Ulid | "">("");
  const [tcoYears, setTcoYears] = useState<number>(5);
  const [tcoScope, setTcoScope] = useState<Ulid | "">("");
  const [issueCycle, setIssueCycle] = useState<Record<string, number>>({});

  const issues = useMemo(
    () => [...lintWorkspace(ws)].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    [ws],
  );
  const matrix = useMemo(() => {
    const systems = [...ws.elements.values()]
      .filter((e) => e.parentId === null && e.kind !== "group")
      .map((e) => e.id);
    return dependencyMatrix(ws, systems);
  }, [ws]);

  const impact = useMemo(() => {
    if (!impactRoot) return null;
    return [...downstreamOf(ws, impactRoot)].map((id) => ws.element(id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [ws, impactRoot]);

  const name = (id: Ulid) => ws.elements.get(id)?.name ?? id;
  const elements = [...ws.elements.values()]
    .filter((e) => e.kind !== "group")
    .sort((a, b) => a.name.localeCompare(b.name));

  // TCO (§TCO plan Phase 3): same "current temporal context, fall back to all time"
  // convention as the rest of this drawer's sections (they read straight off the store).
  const estateTcoResult = useMemo(() => estateTco(ws, temporal, tcoYears), [ws, temporal, tcoYears]);

  // Systems/containers worth offering as a scope: they have a positive rolled-up cost.
  const scopeOptions = useMemo(
    () =>
      estateTcoResult.rows.filter(
        (r) => (r.kind === "system" || r.kind === "container") && r.rolledUpAnnual > 0,
      ),
    [estateTcoResult],
  );
  // Reset an out-of-date scope selection (e.g. its cost was removed) back to the whole estate.
  const validScope = tcoScope && scopeOptions.some((r) => r.id === tcoScope) ? tcoScope : "";

  const tco = useMemo(
    () => (validScope ? subtreeTco(ws, validScope, temporal, tcoYears) : estateTcoResult),
    [ws, temporal, tcoYears, validScope, estateTcoResult],
  );
  const tcoMixed = tco.currencies.length > 1;
  const tcoCurrency = tco.currencies.length === 1 ? tco.currencies[0]! : "GBP";

  const selectIssueId = (issue: LintIssue) => {
    if (issue.ids.length === 0) return;
    const key = issueKey(issue);
    const index = issueCycle[key] ?? 0;
    const id = issue.ids[index % issue.ids.length];
    setIssueCycle((prev) => ({ ...prev, [key]: index + 1 }));
    if (id && ws.elements.has(id)) select({ type: "element", id });
  };

  return (
    <motion.aside
      data-testid="analysis-drawer"
      className="absolute inset-y-0 right-0 z-30 flex w-[26rem] flex-col border-l border-slate-200 bg-white shadow-xl"
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">Estate analysis</h2>
        <button
          data-testid="analysis-close"
          onClick={onClose}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Consistency report
          </h3>
          {issues.length === 0 ? (
            <p className="text-xs text-emerald-600" data-testid="lint-clean">
              No issues — every element is placed and names are unique in scope.
            </p>
          ) : (
            <ul className="space-y-1" data-testid="lint-issues">
              {issues.map((issue, i) => (
                <li
                  key={i}
                  data-testid="lint-issue"
                  data-severity={issue.severity}
                  className={`cursor-pointer rounded border px-2 py-1 text-xs ${SEVERITY_CLASSES[issue.severity]}`}
                  onClick={() => selectIssueId(issue)}
                >
                  <span className="font-semibold">{issue.code}</span> — {issue.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Dependency matrix (top-level systems)
          </h3>
          <div className="overflow-x-auto">
            <table className="text-[10px]" data-testid="dependency-matrix">
              <thead>
                <tr>
                  <th className="p-1 text-left text-slate-400">from \ to</th>
                  {matrix.ids.map((id) => (
                    <th key={id} className="max-w-16 truncate p-1 text-left font-medium text-slate-600">
                      {name(id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.ids.map((rowId, i) => (
                  <tr key={rowId}>
                    <td className="max-w-24 truncate p-1 font-medium text-slate-600">{name(rowId)}</td>
                    {matrix.ids.map((colId, j) => {
                      const count = matrix.counts[i]?.[j] ?? 0;
                      return (
                        <td
                          key={colId}
                          className={`p-1 text-center ${count ? "bg-blue-100 font-semibold text-blue-800" : "text-slate-300"}`}
                        >
                          {count || "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Impact — what is downstream of…
          </h3>
          <select
            data-testid="impact-select"
            className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={impactRoot}
            onChange={(e) => setImpactRoot(e.target.value as Ulid)}
          >
            <option value="">Choose an element…</option>
            {elements.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          {impact && (
            <ul className="space-y-0.5" data-testid="impact-list">
              {impact.length === 0 && <li className="text-xs text-slate-400">Nothing downstream.</li>}
              {impact.map((e) => (
                <li
                  key={e.id}
                  className="cursor-pointer rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  onClick={() => select({ type: "element", id: e.id })}
                >
                  {e.name}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section data-testid="tco-section">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            TCO (total cost of ownership)
          </h3>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Horizon
              <select
                data-testid="tco-years"
                className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
                value={tcoYears}
                onChange={(e) => setTcoYears(Number(e.target.value))}
              >
                {TCO_YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}-year
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Scope
              <select
                data-testid="tco-scope"
                className="max-w-32 rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
                value={validScope}
                onChange={(e) => setTcoScope(e.target.value as Ulid | "")}
              >
                <option value="">Whole estate</option>
                {scopeOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600" title="Tint canvas nodes by rolled-up annual cost">
              <input
                data-testid="tco-overlay-toggle"
                type="checkbox"
                checked={costOverlay}
                onChange={(e) => useAtlas.setState({ costOverlay: e.target.checked })}
              />
              Cost overlay
            </label>
          </div>

          {tcoMixed && (
            <p data-testid="tco-mixed-warning" className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Mixed currencies — totals are shown per currency below, never added together
            </p>
          )}

          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
            <span>
              Total run-rate:{" "}
              <span data-testid="tco-total-annual" className="font-semibold tabular-nums">
                {tcoMixed ? formatTotalsByCurrency(tco, "/yr") : `${formatMoney(tco.totalAnnual, tcoCurrency)}/yr`}
              </span>
            </span>
            <span>
              {tcoYears}-yr TCO:{" "}
              <span data-testid="tco-total" className="font-semibold tabular-nums">
                {tcoMixed ? formatTotalsByCurrency(tco, "") : formatMoney(tco.totalTco, tcoCurrency)}
              </span>
            </span>
          </div>

          {tco.rows.length === 0 ? (
            <p data-testid="tco-empty" className="text-xs text-slate-400">
              No costs recorded yet — add them in the Inspector's Costs section.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]" data-testid="tco-table">
                  <thead>
                    <tr>
                      <th className="p-1 text-left text-slate-400">Element</th>
                      <th className="p-1 text-right text-slate-400">Own £/yr</th>
                      <th className="p-1 text-right text-slate-400">Rolled-up £/yr</th>
                      <th className="p-1 text-right text-slate-400">{tcoYears}-yr TCO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tco.rows.map((r) => {
                      // A row is only safe to print with a single currency symbol when every cost
                      // entry in its own+rolled-up figure agrees on currency; otherwise fall back
                      // to a plain (unlabelled) number, same rule as the estate totals above.
                      const rowCurrency = r.currencies.length === 1 ? r.currencies[0] : undefined;
                      const fmt = (n: number) => (rowCurrency ? formatMoney(n, rowCurrency) : formatPlain(n));
                      return (
                        <tr
                          key={r.id}
                          data-testid="tco-row"
                          className="cursor-pointer hover:bg-slate-50"
                          onClick={() => select({ type: "element", id: r.id })}
                        >
                          <td className="max-w-32 truncate p-1">
                            {r.name}{" "}
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-500">
                              {r.kind}
                            </span>
                          </td>
                          <td className="p-1 text-right tabular-nums">{fmt(r.ownAnnual)}</td>
                          <td className="p-1 text-right tabular-nums">{fmt(r.rolledUpAnnual)}</td>
                          <td className="p-1 text-right tabular-nums">{fmt(r.tco)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                data-testid="tco-export-csv"
                onClick={() => downloadTcoCsv(tco.rows, tcoYears)}
                className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Export CSV
              </button>
            </>
          )}
        </section>
      </div>
    </motion.aside>
  );
}
