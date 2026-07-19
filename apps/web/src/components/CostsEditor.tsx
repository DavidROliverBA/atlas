import { useState } from "react";
import {
  annualisedAmount,
  type CostCategory,
  type CostClassification,
  type CostConfidence,
  type CostEntry,
  type Element,
  type NamedState,
} from "@atlas/core";
import { useAtlas } from "../store";

/** Fixed cost-category perimeter (docs/tco-plan.md §2) — not user-extensible in v1. */
const CATEGORIES: CostCategory[] = [
  "licences",
  "infrastructure",
  "people",
  "vendor-services",
  "change",
  "decommission",
  "other",
];
const CATEGORY_LABELS: Record<CostCategory, string> = {
  licences: "Licences",
  infrastructure: "Infrastructure",
  people: "People",
  "vendor-services": "Vendor services",
  change: "Change",
  decommission: "Decommission",
  other: "Other",
};
const CLASSIFICATIONS: CostClassification[] = ["run", "change", "acquire", "retire"];
const CLASSIFICATION_LABELS: Record<CostClassification, string> = {
  run: "Run",
  change: "Change",
  acquire: "Acquire",
  retire: "Retire",
};
const CONFIDENCES: CostConfidence[] = ["estimate", "quoted", "actual"];
const CONFIDENCE_LABELS: Record<CostConfidence, string> = {
  estimate: "Estimate",
  quoted: "Quoted",
  actual: "Actual",
};

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none";
const smallInputClass = `${inputClass} text-xs`;

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Formats an element's own annual cost total the way the section header summarises it. */
function summariseCosts(entries: CostEntry[]): string {
  if (entries.length === 0) return "No costs";
  const countLabel = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  const currencies = new Set(entries.map((e) => e.currency ?? "GBP"));
  if (currencies.size > 1) return `${countLabel} · mixed currencies`;
  const currency = [...currencies][0] ?? "GBP";
  const total = entries.reduce((sum, e) => sum + annualisedAmount(e), 0);
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(total);
  } catch {
    // Not-yet-valid ISO 4217 code (e.g. mid-edit) — fall back to a plain number.
    formatted = `${currency} ${total.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
  }
  return `${countLabel} · ${formatted}/yr`;
}

function validateEntry(entry: CostEntry): string | null {
  if (!entry.label.trim()) return "Give the entry a label";
  if (!(entry.amount > 0)) return "Amount must be greater than zero";
  if (entry.validFrom && entry.validTo && entry.validFrom > entry.validTo) {
    return "Valid from must be before valid to";
  }
  return null;
}

/**
 * Single cost-entry card. Edits are buffered locally in `draft` and only
 * committed (via `onChange`, which the parent turns into a single
 * `updateElement` dispatch of the whole costs array) once the entry is
 * valid — a fresh "Add cost" row starts at amount 0, which is invalid, so
 * nothing is dispatched until the amount is filled in.
 */
function CostRow({
  entry,
  states,
  onChange,
  onDelete,
}: {
  entry: CostEntry;
  states: NamedState[];
  onChange: (next: CostEntry) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<CostEntry>(entry);
  const [error, setError] = useState<string | null>(() => validateEntry(entry));

  const apply = (patch: Partial<CostEntry>) => {
    const next: CostEntry = { ...draft, ...patch };
    if (next.kind === "recurring") {
      delete next.amortiseYears;
    } else {
      delete next.period;
      if (!next.amortiseYears) delete next.amortiseYears;
    }
    if (!next.currency) delete next.currency;
    if (!next.confidence) delete next.confidence;
    if (!next.validFrom) delete next.validFrom;
    if (!next.validTo) delete next.validTo;
    if (!next.states?.length) delete next.states;

    setDraft(next);
    const issue = validateEntry(next);
    setError(issue);
    if (!issue) onChange(next);
  };

  return (
    <div data-testid="cost-row" className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="mb-2 flex items-center gap-2">
        <input
          key={entry.id}
          data-testid="cost-label"
          className={`${inputClass} flex-1`}
          placeholder="Label"
          defaultValue={draft.label}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== draft.label) apply({ label: v });
          }}
        />
        <button
          type="button"
          data-testid="cost-delete"
          title="Delete cost entry"
          onClick={onDelete}
          className="text-slate-400 hover:text-red-500"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SmallField label="Category">
          <select
            data-testid="cost-category"
            className={smallInputClass}
            value={draft.category}
            onChange={(e) => apply({ category: e.target.value as CostCategory })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </SmallField>
        <SmallField label="Classification">
          <select
            data-testid="cost-classification"
            className={smallInputClass}
            value={draft.classification}
            onChange={(e) => apply({ classification: e.target.value as CostClassification })}
          >
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {CLASSIFICATION_LABELS[c]}
              </option>
            ))}
          </select>
        </SmallField>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <SmallField label="Kind">
          <select
            data-testid="cost-kind"
            className={smallInputClass}
            value={draft.kind}
            onChange={(e) => apply({ kind: e.target.value as CostEntry["kind"] })}
          >
            <option value="recurring">Recurring</option>
            <option value="one-off">One-off</option>
          </select>
        </SmallField>
        <SmallField label="Confidence">
          <select
            data-testid="cost-confidence"
            className={smallInputClass}
            value={draft.confidence ?? ""}
            onChange={(e) => apply({ confidence: (e.target.value || undefined) as CostConfidence | undefined })}
          >
            <option value="">—</option>
            {CONFIDENCES.map((c) => (
              <option key={c} value={c}>
                {CONFIDENCE_LABELS[c]}
              </option>
            ))}
          </select>
        </SmallField>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <SmallField label="Amount">
          <input
            key={entry.id}
            data-testid="cost-amount"
            type="number"
            min="0"
            step="any"
            className={smallInputClass}
            defaultValue={draft.amount}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (v !== draft.amount) apply({ amount: v });
            }}
          />
        </SmallField>
        <SmallField label="Currency">
          <input
            key={entry.id}
            data-testid="cost-currency"
            className={smallInputClass}
            placeholder="GBP"
            defaultValue={draft.currency ?? ""}
            onBlur={(e) => {
              const v = e.target.value.trim().toUpperCase();
              if (v !== (draft.currency ?? "")) apply({ currency: v || undefined });
            }}
          />
        </SmallField>
      </div>

      {draft.kind === "recurring" ? (
        <div className="mt-2">
          <SmallField label="Period">
            <select
              data-testid="cost-period"
              className={smallInputClass}
              value={draft.period ?? "annual"}
              onChange={(e) => apply({ period: e.target.value as "monthly" | "annual" })}
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </SmallField>
        </div>
      ) : (
        <div className="mt-2">
          <SmallField label="Amortise over (years)">
            <input
              key={entry.id}
              data-testid="cost-amortise-years"
              type="number"
              min="1"
              max="50"
              placeholder="3"
              className={smallInputClass}
              defaultValue={draft.amortiseYears ?? ""}
              onBlur={(e) => {
                const v = e.target.value === "" ? undefined : Number(e.target.value);
                if (v !== draft.amortiseYears) apply({ amortiseYears: v });
              }}
            />
          </SmallField>
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <SmallField label="Valid from">
          <input
            data-testid="cost-valid-from"
            type="date"
            className={smallInputClass}
            value={draft.validFrom ?? ""}
            onChange={(e) => apply({ validFrom: e.target.value || undefined })}
          />
        </SmallField>
        <SmallField label="Valid to (retired after)">
          <input
            data-testid="cost-valid-to"
            type="date"
            className={smallInputClass}
            value={draft.validTo ?? ""}
            onChange={(e) => apply({ validTo: e.target.value || undefined })}
          />
        </SmallField>
      </div>

      {states.length > 0 && (
        <div className="mt-2">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            State membership
          </span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {states.map((s) => {
              const member = draft.states?.includes(s.id) ?? false;
              return (
                <label key={s.id} className="flex cursor-pointer items-center gap-1 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    data-testid={`cost-state-${s.name}`}
                    checked={member}
                    onChange={() => {
                      const current = draft.states ?? [];
                      apply({
                        states: member ? current.filter((id) => id !== s.id) : [...current, s.id],
                      });
                    }}
                  />
                  {s.name}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <p data-testid="cost-error" className="mt-1.5 text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "Costs" inspector section (docs/tco-plan.md §Phase 2): entry list rolled
 * up from `element.costs`, plus an "Add cost" flow. Every mutation dispatches
 * a single `updateElement` command carrying the complete new `costs` array,
 * so undo/redo and the AI/API/CLI paths all get it for free — the same
 * pattern as the colour picker and TemporalEditor above.
 */
export function CostsEditor({ element }: { element: Element }) {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const dispatch = useAtlas((s) => s.dispatch);
  const newId = useAtlas((s) => s.newId);
  const [collapsed, setCollapsed] = useState(true);
  const [pending, setPending] = useState<CostEntry | null>(null);

  const entries = element.costs ?? [];
  const states = [...ws.states.values()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  const commit = (next: CostEntry[]) => {
    dispatch({ type: "updateElement", id: element.id, changes: { costs: (next.length ? next : null) as never } });
  };

  const updateEntry = (updated: CostEntry) => {
    commit(entries.map((e) => (e.id === updated.id ? updated : e)));
  };

  const deleteEntry = (id: string) => {
    commit(entries.filter((e) => e.id !== id));
  };

  const commitPending = (draft: CostEntry) => {
    commit([...entries, draft]);
    setPending(null);
  };

  const addCost = () => {
    setPending({
      id: newId(),
      label: "",
      category: "other",
      classification: "run",
      kind: "recurring",
      amount: 0,
    });
    setCollapsed(false);
  };

  return (
    <div data-testid="costs-section" className="border-t border-slate-200 pt-3">
      <button
        type="button"
        data-testid="costs-toggle"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {collapsed ? "▸" : "▾"} Costs
        </span>
        <span data-testid="costs-summary" className="text-xs text-slate-500">
          {summariseCosts(entries)}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-2 flex flex-col gap-2">
          {entries.map((entry) => (
            <CostRow key={entry.id} entry={entry} states={states} onChange={updateEntry} onDelete={() => deleteEntry(entry.id)} />
          ))}
          {pending && (
            <CostRow
              key={pending.id}
              entry={pending}
              states={states}
              onChange={commitPending}
              onDelete={() => setPending(null)}
            />
          )}
          <button
            type="button"
            data-testid="cost-add"
            onClick={addCost}
            className="self-start rounded-md bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700"
          >
            + Add cost
          </button>
        </div>
      )}
    </div>
  );
}
