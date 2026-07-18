/**
 * Estate analysis (§3.5): orphan and consistency reports, dependency matrix,
 * and downstream impact — list/tree projections of the model graph.
 */

import { useMemo, useState } from "react";
import { dependencyMatrix, downstreamOf, lintWorkspace, type Ulid } from "@atlas/core";
import { motion } from "framer-motion";
import { useAtlas } from "../store";

export function AnalysisDrawer({ onClose }: { onClose: () => void }) {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const select = useAtlas((s) => s.select);
  const [impactRoot, setImpactRoot] = useState<Ulid | "">("");

  const issues = useMemo(() => lintWorkspace(ws), [ws]);
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
                  className="cursor-pointer rounded border border-orange-200 bg-orange-50 px-2 py-1 text-xs text-orange-800 hover:bg-orange-100"
                  onClick={() => {
                    const id = issue.ids[0];
                    if (id && ws.elements.has(id)) select({ type: "element", id });
                  }}
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
      </div>
    </motion.aside>
  );
}
