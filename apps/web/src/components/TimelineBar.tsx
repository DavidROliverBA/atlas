/**
 * Time controls (§3.6): a lens over every view. "All time" shows everything;
 * a named state or a scrubbed date re-evaluates visibility; compare mode
 * renders a diff overlay (added = green, removed = red, changed = amber)
 * plus a textual change report.
 */

import { useMemo, useState } from "react";
import { diffContexts, diffReport, estateTco, tcoDiff, type TemporalContext } from "@atlas/core";
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

/** Create, rename, date and delete named states — the authoring side of the scrubber. */
function StatesManager({ onClose }: { onClose: () => void }) {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const dispatch = useAtlas((s) => s.dispatch);
  const newId = useAtlas((s) => s.newId);
  const states = [...ws.states.values()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

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
        {states.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5" data-testid={`state-row-${s.name}`}>
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

  const states = [...ws.states.values()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

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
          title="Create, rename or delete named states"
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
            ? "Run rate: mixed"
            : `Run rate: ${formatCompact(runRate.totalAnnual, false)}/yr`}
        </span>

        {states.length >= 2 && (
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
                const [a, b] = [states[0]!, states[states.length - 1]!];
                useAtlas.setState({
                  diffPair: {
                    a: { type: "state", stateId: a.id },
                    b: { type: "state", stateId: b.id },
                  },
                  temporal: { type: "all" },
                });
                setShowReport(true);
              }
            }}
          >
            {diffPair
              ? "Exit compare"
              : `Compare ${states[0]!.name} → ${states[states.length - 1]!.name}`}
          </button>
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
        </div>
      )}
    </div>
  );
}
