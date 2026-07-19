import { useState } from "react";
import type { Element, Lifecycle, StateOverride, Ulid } from "@atlas/core";
import { useAtlas } from "../store";

const STATUSES: Lifecycle[] = ["proposed", "planned", "live", "deprecated", "decommissioned"];

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-400 focus:outline-none";

function smallLabel(text: string) {
  return (
    <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{text}</span>
  );
}

function listFrom(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

/** Drop empty/undefined keys, so a picked-but-blank field means "no override". */
function pruneOverride(o: StateOverride): StateOverride {
  const next: Record<string, unknown> = { ...o };
  for (const [key, value] of Object.entries(next)) {
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (empty) delete next[key];
  }
  return next as StateOverride;
}

/**
 * "State overrides" inspector section (temporal engine, §3.6): per-named-
 * state attribute overrides (name/description/technology/status/tags)
 * applied when viewing the model in that state. Only rendered when the
 * workspace has named states. Every mutation dispatches a single
 * `updateElement` carrying the complete new `stateOverrides` map — the
 * picked state's entry is replaced (or dropped once empty), and the whole
 * map clears to `null` once no state has an override left, mirroring
 * CostsEditor's and TemporalEditor's whole-value-per-command convention.
 */
export function StateOverridesEditor({ element }: { element: Element }) {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const dispatch = useAtlas((s) => s.dispatch);
  const [collapsed, setCollapsed] = useState(true);

  const states = [...ws.states.values()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const [stateId, setStateId] = useState<Ulid>(states[0]?.id ?? "");

  if (states.length === 0) return null;

  const overrides = element.stateOverrides ?? {};
  const overriddenCount = Object.keys(overrides).length;
  const activeStateId = states.some((s) => s.id === stateId) ? stateId : states[0]!.id;
  const current = overrides[activeStateId] ?? {};

  const commit = (patch: Partial<StateOverride>) => {
    const merged = pruneOverride({ ...current, ...patch });
    const next = { ...overrides };
    if (Object.keys(merged).length) next[activeStateId] = merged;
    else delete next[activeStateId];
    dispatch({
      type: "updateElement",
      id: element.id,
      changes: { stateOverrides: (Object.keys(next).length ? next : null) as never },
    });
  };

  const clearState = () => {
    const next = { ...overrides };
    delete next[activeStateId];
    dispatch({
      type: "updateElement",
      id: element.id,
      changes: { stateOverrides: (Object.keys(next).length ? next : null) as never },
    });
  };

  return (
    <div data-testid="overrides-section" className="border-t border-slate-200 pt-3">
      <button
        type="button"
        data-testid="overrides-toggle"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {collapsed ? "▸" : "▾"} State overrides
        </span>
        <span data-testid="overrides-summary" className="text-xs text-slate-500">
          {overriddenCount === 0
            ? "No overrides"
            : `${overriddenCount} ${overriddenCount === 1 ? "state" : "states"}`}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="block">
            {smallLabel("State")}
            <select
              data-testid="overrides-state-picker"
              className={inputClass}
              value={activeStateId}
              onChange={(e) => setStateId(e.target.value as Ulid)}
            >
              {states.map((s) => {
                const count = Object.keys(overrides[s.id] ?? {}).length;
                return (
                  <option key={s.id} value={s.id}>
                    {count ? `● ${s.name} (${count})` : s.name}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="block">
            {smallLabel("Name")}
            <input
              key={`${element.id}-${activeStateId}-name`}
              data-testid="override-name"
              className={inputClass}
              defaultValue={current.name ?? ""}
              placeholder="(no override)"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (current.name ?? "")) commit({ name: v || undefined });
              }}
            />
          </label>

          <label className="block">
            {smallLabel("Description")}
            <input
              key={`${element.id}-${activeStateId}-description`}
              data-testid="override-description"
              className={inputClass}
              defaultValue={current.description ?? ""}
              placeholder="(no override)"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (current.description ?? "")) commit({ description: v || undefined });
              }}
            />
          </label>

          <label className="block">
            {smallLabel("Technology (comma-separated)")}
            <input
              key={`${element.id}-${activeStateId}-technology`}
              data-testid="override-technology"
              className={inputClass}
              defaultValue={current.technology?.join(", ") ?? ""}
              placeholder="(no override)"
              onBlur={(e) => commit({ technology: listFrom(e.target.value) })}
            />
          </label>

          <label className="block">
            {smallLabel("Status")}
            <select
              data-testid="override-status"
              className={inputClass}
              value={current.status ?? ""}
              onChange={(e) => commit({ status: (e.target.value || undefined) as Lifecycle | undefined })}
            >
              <option value="">(no override)</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            {smallLabel("Tags (comma-separated)")}
            <input
              key={`${element.id}-${activeStateId}-tags`}
              data-testid="override-tags"
              className={inputClass}
              defaultValue={current.tags?.join(", ") ?? ""}
              placeholder="(no override)"
              onBlur={(e) => commit({ tags: listFrom(e.target.value) })}
            />
          </label>

          <button
            type="button"
            data-testid="overrides-clear"
            onClick={clearState}
            disabled={Object.keys(current).length === 0}
            className="self-start rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Clear overrides for this state
          </button>
        </div>
      )}
    </div>
  );
}
