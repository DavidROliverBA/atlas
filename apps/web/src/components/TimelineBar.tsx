/**
 * Time controls (§3.6): a lens over every view. "All time" shows everything;
 * a named state or a scrubbed date re-evaluates visibility; compare mode
 * renders a diff overlay (added = green, removed = red, changed = amber)
 * plus a textual change report.
 */

import { useMemo, useState } from "react";
import {
  diffContexts,
  diffReport,
  estateTco,
  tcoDiff,
  type Command,
  type NamedState,
  type TemporalContext,
  type Ulid,
} from "@atlas/core";
import { useAtlas } from "../store";

const MONTH_MS = 30.44 * 24 * 3600 * 1000;
const TCO_DIFF_YEARS = 5;

const compactGbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Compact "£4.1M"-style figure, or a plain compact number when currencies are mixed. */
function formatCompact(amount: number, mixed: boolean): string {
  if (mixed) return new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(amount);
  return compactGbp.format(amount);
}

/** Signed compact delta, e.g. "+£120k" / "-£3.4M". */
function formatDelta(amount: number, mixed: boolean): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${formatCompact(Math.abs(amount), mixed)}`;
}

/** Same as `formatCompact`, but with a specific currency's own symbol (always safe — never mixed). */
function formatCompactCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(
    amount,
  );
}

/** Signed compact delta in one currency, e.g. "+$120k". */
function formatDeltaCurrency(amount: number, currency: string): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${formatCompactCurrency(Math.abs(amount), currency)}`;
}

function monthRange(startYear: number, endYear: number): string[] {
  const out: string[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, "0")}-01`);
  }
  return out;
}

function ctxLabel(ws: ReturnType<typeof useAtlas.getState>["ws"], ctx: TemporalContext): string {
  if (ctx.type === "all") return "All time";
  if (ctx.type === "date") return ctx.date;
  return ws.states.get(ctx.stateId)?.name ?? "state";
}

/** States sort by explicit order first (undated/unordered states sort last), then date, then name. */
function compareStates(a: NamedState, b: NamedState): number {
  const orderA = a.order ?? Infinity;
  const orderB = b.order ?? Infinity;
  if (orderA !== orderB) return orderA - orderB;
  const dateCmp = (a.date ?? "").localeCompare(b.date ?? "");
  if (dateCmp !== 0) return dateCmp;
  return a.name.localeCompare(b.name);
}

/** Renumber every state's `order` to its position in `states`, except swap `index` and `otherIndex`. */
function reorderCommand(states: NamedState[], index: number, otherIndex: number): Command {
  const commands: Command[] = states.map((s, i) => ({
    type: "updateState",
    id: s.id,
    changes: { order: i },
  }));
  commands[index] = { type: "updateState", id: states[index]!.id, changes: { order: otherIndex } };
  commands[otherIndex] = { type: "updateState", id: states[otherIndex]!.id, changes: { order: index } };
  return { type: "batch", commands };
}

/** Create, rename, date, reorder and delete named states — the authoring side of the scrubber. */
function StatesManager({ onClose }: { onClose: () => void }) {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const dispatch = useAtlas((s) => s.dispatch);
  const newId = useAtlas((s) => s.newId);
  const states = [...ws.states.values()].sort(compareStates);

  return (
    <div data-testid="states-manager" className="border-t border-slate-100 bg-slate-50 px-4 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Named states
        </span>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">
          done
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {states.map((s, i) => (
          <div key={s.id} className="flex items-center gap-1.5" data-testid={`state-row-${s.name}`}>
            <div className="flex flex-col leading-none">
              <button
                data-testid={`state-up-${s.name}`}
                title="Move earlier"
                disabled={i === 0}
                onClick={() => dispatch(reorderCommand(states, i, i - 1))}
                className="text-[9px] text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400"
              >
                ▲
              </button>
              <button
                data-testid={`state-down-${s.name}`}
                title="Move later"
                disabled={i === states.length - 1}
                onClick={() => dispatch(reorderCommand(states, i, i + 1))}
                className="text-[9px] text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400"
              >
                ▼
              </button>
            </div>
            <input
              className="w-44 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
              defaultValue={s.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== s.name) dispatch({ type: "updateState", id: s.id, changes: { name } });
              }}
            />
            <input
              type="date"
              className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
              value={s.date ?? ""}
              onChange={(e) =>
                dispatch({ type: "updateState", id: s.id, changes: { date: (e.target.value || null) as never } })
              }
            />
            <button
              data-testid={`state-delete-${s.name}`}
              title="Delete state (memberships and overrides are cleaned up; undoable)"
              onClick={() =>
                window.confirm(`Delete state "${s.name}"? Membership and overrides referencing it are removed (undoable).`) &&
                dispatch({ type: "deleteState", id: s.id })
              }
              className="rounded px-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          data-testid="state-add"
          onClick={() => {
            const existing = states.filter((s) => s.name.startsWith("New state")).length;
            dispatch({
              type: "createState",
              state: { id: newId(), name: existing ? `New state ${existing + 1}` : "New state" },
            });
          }}
          className="self-start rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
        >
          + Add state
        </button>
      </div>
    </div>
  );
}

export function TimelineBar() {
  const ws = useAtlas((s) => s.ws);
  const rev = useAtlas((s) => s.rev);
  const temporal = useAtlas((s) => s.temporal);
  const diffPair = useAtlas((s) => s.diffPair);
  const [showReport, setShowReport] = useState(false);
  const [managing, setManaging] = useState(false);
  // Pending compare selections (used to seed diffPair when compare mode is switched on, and to
  // steer it live once it's active). Fall back to first/last of the sorted states until touched.
  const [diffAId, setDiffAId] = useState<Ulid | null>(null);
  const [diffBId, setDiffBId] = useState<Ulid | null>(null);

  const states = [...ws.states.values()].sort(compareStates);
  const defaultA = states[0]?.id ?? null;
  const defaultB = states[states.length - 1]?.id ?? null;
  const effectiveA = diffAId && states.some((s) => s.id === diffAId) ? diffAId : defaultA;
  const effectiveB = diffBId && states.some((s) => s.id === diffBId) ? diffBId : defaultB;

  const months = useMemo(() => {
    const dates: string[] = [];
    for (const e of ws.elements.values()) {
      if (e.temporal?.validFrom) dates.push(e.temporal.validFrom);
      if (e.temporal?.validTo) dates.push(e.temporal.validTo);
    }
    for (const s of ws.states.values()) if (s.date) dates.push(s.date);
    const years = dates.map((d) => Number(d.slice(0, 4)));
    const start = (years.length ? Math.min(...years) : 2025) - 1;
    const end = (years.length ? Math.max(...years) : 2028) + 1;
    return monthRange(start, end);
  }, [ws]);

  const sliderIndex =
    temporal.type === "date"
      ? Math.max(
          0,
          months.findIndex((m) => m >= temporal.date),
        )
      : Math.round(
          months.findIndex((m) => Date.now() - new Date(m).getTime() < MONTH_MS) >= 0
            ? months.findIndex((m) => Date.now() - new Date(m).getTime() < MONTH_MS)
            : months.length / 2,
        );

  const report = useMemo(() => {
    if (!diffPair) return null;
    return diffReport(ws, diffContexts(ws, diffPair.a, diffPair.b));
  }, [ws, rev, diffPair]);

  // Phase 4 (§tco-plan.md): estate run-rate under the active context, live as the
  // scrubber moves; independent of diff mode so it always reflects `temporal`. `ws`
  // is a mutable instance (commands mutate it in place rather than replacing the
  // reference), so `rev` must be in the dependency list or this goes stale after
  // any cost edit that doesn't also change `temporal`.
  const runRate = useMemo(() => estateTco(ws, temporal, 1), [ws, rev, temporal]);

  const costDelta = useMemo(() => {
    if (!diffPair) return null;
    const delta = tcoDiff(ws, diffPair.a, diffPair.b, TCO_DIFF_YEARS);
    const mixed =
      estateTco(ws, diffPair.a, TCO_DIFF_YEARS).currencies.length > 1 ||
      estateTco(ws, diffPair.b, TCO_DIFF_YEARS).currencies.length > 1;
    return { delta, mixed };
  }, [ws, rev, diffPair]);

  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-0.5 text-xs ${
      active ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
    }`;

  const startCompare = (aId: Ulid, bId: Ulid) => {
    useAtlas.setState({
      diffPair: { a: { type: "state", stateId: aId }, b: { type: "state", stateId: bId } },
      temporal: { type: "all" },
    });
    setShowReport(true);
  };

  return (
    <div className="border-t border-slate-200 bg-white" data-testid="timeline-bar">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Time</span>
        <button
          data-testid="time-all"
          className={chip(temporal.type === "all" && !diffPair)}
          onClick={() => useAtlas.setState({ temporal: { type: "all" }, diffPair: null })}
        >
          All time
        </button>
        <button
          data-testid="states-manage"
          title="Create, rename, reorder or delete named states"
          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200"
          onClick={() => setManaging((m) => !m)}
        >
          ⚙ States
        </button>
        {states.map((s) => (
          <button
            key={s.id}
            data-testid={`time-state-${s.name}`}
            className={chip(temporal.type === "state" && temporal.stateId === s.id && !diffPair)}
            onClick={() =>
              useAtlas.setState({ temporal: { type: "state", stateId: s.id }, diffPair: null })
            }
            title={s.date ?? "logical state"}
          >
            {s.name}
          </button>
        ))}
        <div className="mx-2 flex flex-1 items-center gap-2">
          <input
            data-testid="time-scrubber"
            type="range"
            min={0}
            max={months.length - 1}
            value={temporal.type === "date" ? sliderIndex : 0}
            onChange={(e) => {
              const date = months[Number(e.target.value)];
              if (date) useAtlas.setState({ temporal: { type: "date", date }, diffPair: null });
            }}
            className="flex-1 accent-slate-700"
          />
          <span
            data-testid="time-label"
            className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-600"
          >
            {diffPair ? "comparing…" : ctxLabel(ws, temporal)}
          </span>
        </div>

        <span
          data-testid="timeline-runrate"
          className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs tabular-nums text-slate-600"
          title="Estate annual run-rate under the active temporal context"
        >
          {runRate.currencies.length > 1
            ? `Run rate: ${runRate.currencies
                .map((c) => formatCompactCurrency(runRate.byCurrency[c]!.totalAnnual, c))
                .join(" + ")} /yr`
            : `Run rate: ${formatCompact(runRate.totalAnnual, false)}/yr`}
        </span>

        {states.length >= 2 && (
          <>
            <select
              data-testid="diff-a"
              title="Compare from"
              className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
              value={effectiveA ?? ""}
              onChange={(e) => {
                const id = e.target.value as Ulid;
                setDiffAId(id);
                if (diffPair) startCompare(id, effectiveB!);
              }}
            >
              {states
                .filter((s) => s.id !== effectiveB)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <span className="text-xs text-slate-400">→</span>
            <select
              data-testid="diff-b"
              title="Compare to"
              className="rounded-md border border-slate-300 px-1.5 py-0.5 text-xs"
              value={effectiveB ?? ""}
              onChange={(e) => {
                const id = e.target.value as Ulid;
                setDiffBId(id);
                if (diffPair) startCompare(effectiveA!, id);
              }}
            >
              {states
                .filter((s) => s.id !== effectiveA)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <button
              data-testid="diff-toggle"
              className={`rounded-md border px-2 py-1 text-xs ${
                diffPair
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
              onClick={() => {
                if (diffPair) {
                  useAtlas.setState({ diffPair: null });
                  setShowReport(false);
                } else {
                  startCompare(effectiveA!, effectiveB!);
                }
              }}
            >
              {diffPair ? "Exit compare" : "Compare"}
            </button>
          </>
        )}
      </div>

      {managing && <StatesManager onClose={() => setManaging(false)} />}
      {diffPair && showReport && report !== null && (
        <pre
          data-testid="diff-report"
          className="max-h-36 overflow-y-auto border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs leading-relaxed text-slate-700"
        >
          {report}
        </pre>
      )}
      {diffPair && showReport && costDelta && (
        <div
          data-testid="timeline-cost-diff"
          className="space-y-0.5 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs leading-relaxed text-slate-700"
        >
          {costDelta.mixed ? (
            Object.entries(costDelta.delta.byCurrency).map(([currency, d]) => (
              <div key={currency}>
                {currency} annual: {formatCompactCurrency(d.annualA, currency)} →{" "}
                {formatCompactCurrency(d.annualB, currency)} (Δ{" "}
                <span
                  className={
                    d.annualDelta > 0
                      ? "font-semibold text-red-600"
                      : d.annualDelta < 0
                        ? "font-semibold text-emerald-600"
                        : ""
                  }
                >
                  {formatDeltaCurrency(d.annualDelta, currency)}
                </span>
                ) · {TCO_DIFF_YEARS}-yr TCO Δ:{" "}
                <span
                  className={
                    d.tcoDelta > 0
                      ? "font-semibold text-red-600"
                      : d.tcoDelta < 0
                        ? "font-semibold text-emerald-600"
                        : ""
                  }
                >
                  {formatDeltaCurrency(d.tcoDelta, currency)}
                </span>
              </div>
            ))
          ) : (
            <>
              <div>
                Annual: {formatCompact(costDelta.delta.annualA, costDelta.mixed)} →{" "}
                {formatCompact(costDelta.delta.annualB, costDelta.mixed)} (Δ{" "}
                <span
                  className={
                    costDelta.delta.annualDelta > 0
                      ? "font-semibold text-red-600"
                      : costDelta.delta.annualDelta < 0
                        ? "font-semibold text-emerald-600"
                        : ""
                  }
                >
                  {formatDelta(costDelta.delta.annualDelta, costDelta.mixed)}
                </span>
                )
              </div>
              <div>
                {TCO_DIFF_YEARS}-yr TCO Δ:{" "}
                <span
                  className={
                    costDelta.delta.tcoDelta > 0
                      ? "font-semibold text-red-600"
                      : costDelta.delta.tcoDelta < 0
                        ? "font-semibold text-emerald-600"
                        : ""
                  }
                >
                  {formatDelta(costDelta.delta.tcoDelta, costDelta.mixed)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
