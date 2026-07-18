/**
 * Pack-driven stencil palette (§3.2). Everything drawable comes from an
 * enabled stencil pack; enabling/disabling packs is a workspace-manifest
 * change dispatched through the command bus like any other edit.
 */

import { useState } from "react";
import { packRef, type Stencil, type StencilPack, type Ulid } from "@atlas/core";
import { BUILTIN_PACKS } from "@atlas/stencils";
import { DEFAULT_H, DEFAULT_W, enabledPackIds, stencilRegistry, useAtlas } from "../store";

/** Find a free spot on the view, scanning left-to-right, top-to-bottom. */
function freeSpot(occupied: Array<{ x: number; y: number }>): { x: number; y: number } {
  const taken = new Set(occupied.map((p) => `${Math.round(p.x / 4)},${Math.round(p.y / 4)}`));
  for (let y = 0; y < 400; y += DEFAULT_H + 3) {
    for (let x = 0; x < 400; x += DEFAULT_W + 3) {
      if (!taken.has(`${Math.round(x / 4)},${Math.round(y / 4)}`)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function StencilButton({ pack, stencil }: { pack: StencilPack; stencil: Stencil }) {
  const ws = useAtlas((s) => s.ws);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const dispatch = useAtlas((s) => s.dispatch);
  const select = useAtlas((s) => s.select);
  const newId = useAtlas((s) => s.newId);

  const add = () => {
    const view = ws.views.get(activeViewId);
    if (!view) return;
    const parentId: Ulid | null = view.scopeId;
    const id = newId();
    const existing = [...ws.elements.values()].filter((e) => e.name.startsWith(`New ${stencil.name}`)).length;
    const name = existing ? `New ${stencil.name} ${existing + 1}` : `New ${stencil.name}`;
    const spot = freeSpot(view.placements);
    const error = dispatch({
      type: "batch",
      label: `Add ${stencil.name}`,
      commands: [
        {
          type: "createElement",
          element: {
            id,
            kind: stencil.elementType,
            name,
            parentId,
            ...(stencil.defaults?.technology ? { technology: [...stencil.defaults.technology] } : {}),
            ...(stencil.defaults?.tags ? { tags: [...stencil.defaults.tags] } : {}),
            ...(pack.id === "c4-core" ? {} : { stencil: { pack: pack.id, stencil: stencil.id } }),
          },
        },
        { type: "placeOnView", viewId: view.id, placement: { elementId: id, ...spot } },
      ],
    });
    if (!error) select({ type: "element", id });
  };

  return (
    <button
      data-testid={`palette-${stencil.id}`}
      title={`${stencil.name} → ${stencil.elementType}`}
      onClick={add}
      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-left text-xs hover:border-slate-300 hover:bg-slate-50"
    >
      <span
        className="h-5 w-5 shrink-0 [&_svg]:h-full [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: stencil.symbol2d }}
      />
      <span className="truncate">{stencil.name}</span>
    </button>
  );
}

function PackManager({ onClose }: { onClose: () => void }) {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const dispatch = useAtlas((s) => s.dispatch);
  const enabled = enabledPackIds(ws);

  const toggle = (pack: StencilPack) => {
    const ref = packRef(pack);
    const next = enabled.includes(pack.id)
      ? (ws.meta.stencilPacks ?? []).filter((r) => r.split("@")[0] !== pack.id)
      : [...(ws.meta.stencilPacks ?? []), ref];
    dispatch({ type: "updateWorkspaceMeta", changes: { stencilPacks: next.length ? next : null as never } });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2" data-testid="pack-manager">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Stencil packs
        </span>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">
          done
        </button>
      </div>
      {BUILTIN_PACKS.map((pack) => (
        <label key={pack.id} className="flex cursor-pointer items-center gap-2 py--0.5 text-xs text-slate-700">
          <input
            type="checkbox"
            data-testid={`pack-toggle-${pack.id}`}
            checked={enabled.includes(pack.id)}
            onChange={() => toggle(pack)}
          />
          {pack.name}
          <span className="text-slate-400">({pack.stencils.length})</span>
        </label>
      ))}
    </div>
  );
}

export function Palette() {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const [managing, setManaging] = useState(false);
  const [filter, setFilter] = useState("");

  const packs = enabledPackIds(ws)
    .map((id) => stencilRegistry.pack(id))
    .filter((p): p is StencilPack => p !== undefined);

  const q = filter.trim().toLowerCase();

  return (
    <div className="max-h-[45%] overflow-y-auto border-b border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stencils</h2>
        <button
          data-testid="manage-packs"
          onClick={() => setManaging((m) => !m)}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
        >
          Packs…
        </button>
      </div>
      {managing && <PackManager onClose={() => setManaging(false)} />}
      <input
        data-testid="palette-search"
        className="mb-2 mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none"
        placeholder="Filter stencils…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {packs.map((pack) => {
        const stencils = pack.stencils.filter((s) => !q || s.name.toLowerCase().includes(q));
        if (!stencils.length) return null;
        return (
          <div key={pack.id} className="mb-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {pack.name}
            </div>
            <div className="flex flex-col gap-1">
              {stencils.map((s) => (
                <StencilButton key={s.id} pack={pack} stencil={s} />
              ))}
            </div>
          </div>
        );
      })}
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        Click to add to the current view. Removing an object from a view never deletes it
        from the model.
      </p>
    </div>
  );
}
