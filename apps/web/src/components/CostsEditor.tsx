import { useMemo, useState } from "react";
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

/** The CSV header CostsEditor's importer accepts — required columns first, optional from `currency` on. */
const CSV_REQUIRED_COLUMNS = ["label", "category", "classification", "kind", "amount"] as const;
const CSV_OPTIONAL_COLUMNS = [
  "currency",
  "period",
  "amortiseYears",
  "confidence",
  "validFrom",
  "validTo",
] as const;
const CSV_COLUMNS = [...CSV_REQUIRED_COLUMNS, ...CSV_OPTIONAL_COLUMNS];
const CSV_HEADER_HINT = CSV_COLUMNS.join(",");

/**
 * Minimal RFC-4180-ish line splitter: handles quoted fields (`"a, b"`) and
 * escaped quotes (`""`) without a dependency, per the brief. Only splits on
 * commas within a single line — embedded newlines inside a quoted field are
 * out of scope, since the import textarea is meant for small pasted tables.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

type CsvRowResult = { line: number; entry: CostEntry | null; error: string | null };
type CsvParseResult = { headerError: string | null; rows: CsvRowResult[] };

/**
 * Parses and validates pasted CSV against the same rules `validateEntry`
 * enforces, plus enum checks for category/classification/kind (and, since
 * they're structured fields too, period/confidence when present). `id` on
 * every returned entry is `""` — a placeholder, since parsing runs on every
 * keystroke for the inline error preview; real ids come from the store's
 * `newId()` at apply time, once every row has been confirmed valid.
 */
function parseCostCsv(text: string): CsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headerError: "Paste a CSV with a header row", rows: [] };

  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  const unknown = header.filter((h) => !CSV_COLUMNS.includes(h as (typeof CSV_COLUMNS)[number]));
  if (unknown.length) return { headerError: `Unknown column(s): ${unknown.join(", ")}`, rows: [] };
  const missing = CSV_REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { headerError: `Missing required column(s): ${missing.join(", ")}`, rows: [] };

  const rows: CsvRowResult[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    const record: Record<string, string> = {};
    header.forEach((h, idx) => {
      record[h] = (cells[idx] ?? "").trim();
    });
    rows.push({ line: i + 1, ...buildRowEntry(record) });
  }
  return { headerError: null, rows };
}

function buildRowEntry(cells: Record<string, string>): { entry: CostEntry | null; error: string | null } {
  if (!CATEGORIES.includes(cells.category as CostCategory)) {
    return { entry: null, error: `Unknown category "${cells.category ?? ""}"` };
  }
  if (!CLASSIFICATIONS.includes(cells.classification as CostClassification)) {
    return { entry: null, error: `Unknown classification "${cells.classification ?? ""}"` };
  }
  if (cells.kind !== "recurring" && cells.kind !== "one-off") {
    return { entry: null, error: `Kind must be "recurring" or "one-off" (got "${cells.kind ?? ""}")` };
  }
  const amount = Number(cells.amount);
  if (cells.amount === "" || Number.isNaN(amount)) {
    return { entry: null, error: `Amount must be a number (got "${cells.amount ?? ""}")` };
  }

  const entry: CostEntry = {
    id: "",
    label: cells.label ?? "",
    category: cells.category as CostCategory,
    classification: cells.classification as CostClassification,
    kind: cells.kind as CostEntry["kind"],
    amount,
  };

  if (cells.currency) entry.currency = cells.currency.toUpperCase();
  if (entry.kind === "recurring") {
    if (cells.period) {
      if (cells.period !== "monthly" && cells.period !== "annual") {
        return { entry: null, error: `Period must be "monthly" or "annual" (got "${cells.period}")` };
      }
      entry.period = cells.period as "monthly" | "annual";
    }
  } else if (cells.amortiseYears) {
    const years = Number(cells.amortiseYears);
    if (Number.isNaN(years) || years <= 0) {
      return { entry: null, error: `Amortise years must be a positive number (got "${cells.amortiseYears}")` };
    }
    entry.amortiseYears = years;
  }
  if (cells.confidence) {
    if (!CONFIDENCES.includes(cells.confidence as CostConfidence)) {
      return { entry: null, error: `Unknown confidence "${cells.confidence}"` };
    }
    entry.confidence = cells.confidence as CostConfidence;
  }
  if (cells.validFrom) entry.validFrom = cells.validFrom;
  if (cells.validTo) entry.validTo = cells.validTo;

  const issue = validateEntry(entry);
  if (issue) return { entry: null, error: issue };
  return { entry, error: null };
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
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const parsedImport = useMemo(
    () => (importText.trim() ? parseCostCsv(importText) : null),
    [importText],
  );
  const importErrors = parsedImport
    ? parsedImport.headerError
      ? [parsedImport.headerError]
      : parsedImport.rows.filter((r) => r.error).map((r) => `Row ${r.line}: ${r.error}`)
    : [];
  const canApplyImport = !!parsedImport && !parsedImport.headerError && parsedImport.rows.length > 0 && importErrors.length === 0;

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

  const applyImport = () => {
    if (!parsedImport || !canApplyImport) return;
    const imported = parsedImport.rows.map((r) => ({ ...(r.entry as CostEntry), id: newId() }));
    commit([...entries, ...imported]);
    setImportOpen(false);
    setImportText("");
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="cost-add"
              onClick={addCost}
              className="self-start rounded-md bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700"
            >
              + Add cost
            </button>
            <button
              type="button"
              data-testid="cost-import"
              title={`Import a CSV with header: ${CSV_HEADER_HINT} (currency onwards optional; blank cells are omitted)`}
              onClick={() => setImportOpen((v) => !v)}
              className="self-start rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              Import CSV
            </button>
          </div>

          {importOpen && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <textarea
                data-testid="cost-import-text"
                title={`Header: ${CSV_HEADER_HINT}`}
                placeholder={CSV_HEADER_HINT}
                rows={4}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                className={`${inputClass} font-mono text-xs`}
              />
              {importErrors.length > 0 && (
                <ul data-testid="cost-import-errors" className="mt-1.5 list-disc pl-4 text-[11px] text-red-600">
                  {importErrors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="cost-import-apply"
                  disabled={!canApplyImport}
                  onClick={applyImport}
                  className="rounded-md bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Import
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportOpen(false);
                    setImportText("");
                  }}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
