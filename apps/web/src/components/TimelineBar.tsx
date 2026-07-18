/**
 * Time controls (§3.6): a lens over every view. "All time" shows everything;
 * a named state or a scrubbed date re-evaluates visibility; compare mode
 * renders a diff overlay (added = green, removed = red, changed = amber)
 * plus a textual change report.
 */

import { useMemo, useState } from "react";
import { diffContexts, diffReport, type TemporalContext } from "@atlas/core";
import { useAtlas } from "../store";

const MONTH_MS = 30.44 * 24 * 3600 * 1000;

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

export function TimelineBar() {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const temporal = useAtlas((s) => s.temporal);
  const diffPair = useAtlas((s) => s.diffPair);
  const [showReport, setShowReport] = useState(false);

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
  }, [ws, diffPair]);

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

      {diffPair && showReport && report !== null && (
        <pre
          data-testid="diff-report"
          className="max-h-36 overflow-y-auto border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs leading-relaxed text-slate-700"
        >
          {report}
        </pre>
      )}
    </div>
  );
}
