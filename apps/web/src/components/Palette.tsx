/**
 * Stencil palette, organised by C4 level so it is obvious where each stencil
 * belongs: Context (people & systems), Container, Component (incl. every
 * cloud-service stencil), Boundaries. Stencils that don't belong on the
 * current view are disabled with an explanation — the same VIEW_PLACEMENT
 * rule the command bus enforces.
 */

import { useState } from "react";
import {
  VIEW_PLACEMENT,
  packRef,
  type ElementKind,
  type Stencil,
  type StencilPack,
  type Ulid,
  type View,
} from "@atlas/core";
import { BUILTIN_PACKS } from "@atlas/stencils";
import { DEFAULT_H, DEFAULT_W, enabledPackIds, stencilRegistry, useAtlas } from "../store";

/** Find a free spot on the view, scanning left-to-right, top-to-bottom. */
export function freeSpot(occupied: Array<{ x: number; y: number }>): { x: number; y: number } {
  const near = (a: number, b: number) => Math.abs(a - b) < DEFAULT_W + 2;
  for (let y = 0; y < 400; y += DEFAULT_H + 3) {
    for (let x = 0; x < 400; x += DEFAULT_W + 3) {
      if (!occupied.some((p) => near(p.x, x) && Math.abs(p.y - y) < DEFAULT_H + 2)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

const LEVELS: Array<{
  id: string;
  title: string;
  hint: string;
  kinds: ElementKind[];
}> = [
  {
    id: "context",
    title: "Context level",
    hint: "People and software systems — landscape and system-context views",
    kinds: ["person", "system"],
  },
  {
    id: "container",
    title: "Container level",
    hint: "Apps and data stores inside a system — container views",
    kinds: ["container"],
  },
  {
    id: "component",
    title: "Component level",
    hint: "Building blocks inside a container, including all AWS/Azure/GCP services — component views",
    kinds: ["component"],
  },
  {
    id: "boundaries",
    title: "Boundaries",
    hint: "Groups and network zones — usable on any view",
    kinds: ["group"],
  },
];

/** New elements from the palette get the right parent for their kind. */
function parentForKind(kind: ElementKind, view: View): Ulid | null {
  if (kind === "person" || kind === "system") return null; // always top-level
  return view.scopeId; // containers/components/groups nest under the view's scope
}

function StencilButton({
  pack,
  stencil,
  usable,
  viewLabel,
}: {
  pack: StencilPack;
  stencil: Stencil;
  usable: boolean;
  viewLabel: string;
}) {
  const ws = useAtlas((s) => s.ws);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const dispatch = useAtlas((s) => s.dispatch);
  const select = useAtlas((s) => s.select);
  const newId = useAtlas((s) => s.newId);

  const add = () => {
    const view = ws.views.get(activeViewId);
    if (!view) return;
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
            parentId: parentForKind(stencil.elementType, view),
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
      disabled={!usable}
      title={
        usable
          ? `${stencil.name} → ${stencil.elementType}`
          : `${stencil.name} is not available on this ${viewLabel} view — see the level heading for where it belongs`
      }
      onClick={add}
      className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-left text-xs ${
        usable
          ? "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
          : "cursor-not-allowed border-slate-100 bg-slate-50 opacity-45"
      }`}
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
    dispatch({ type: "updateWorkspaceMeta", changes: { stencilPacks: next.length ? next : (null as never) } });
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
        <label key={pack.id} className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
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
  const activeViewId = useAtlas((s) => s.activeViewId);
  const [managing, setManaging] = useState(false);
  const [filter, setFilter] = useState("");

  const view = ws.views.get(activeViewId);
  const viewKind = view?.kind ?? "landscape";
  const placeable = VIEW_PLACEMENT[viewKind];

  const packs = enabledPackIds(ws)
    .map((id) => stencilRegistry.pack(id))
    .filter((p): p is StencilPack => p !== undefined);
  const items = packs.flatMap((pack) => pack.stencils.map((stencil) => ({ pack, stencil })));

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
      {LEVELS.map((level) => {
        const levelItems = items.filter(
          ({ stencil }) =>
            level.kinds.includes(stencil.elementType) &&
            (!q || stencil.name.toLowerCase().includes(q)),
        );
        if (!levelItems.length) return null;
        const usableHere = level.kinds.some((k) => placeable.includes(k));
        return (
          <div key={level.id} className="mb-3" data-testid={`palette-level-${level.id}`}>
            <div className="mb-1 flex items-baseline gap-1.5" title={level.hint}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {level.title}
              </span>
              {!usableHere && (
                <span
                  data-testid={`palette-level-${level.id}-unavailable`}
                  className="rounded bg-slate-100 px-1 text-[9px] uppercase tracking-wide text-slate-400"
                >
                  not on this view
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {levelItems.map(({ pack, stencil }) => (
                <StencilButton
                  key={`${pack.id}/${stencil.id}`}
                  pack={pack}
                  stencil={stencil}
                  usable={placeable.includes(stencil.elementType)}
                  viewLabel={viewKind}
                />
              ))}
            </div>
          </div>
        );
      })}
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        Greyed stencils belong to a different diagram level — the heading says where.
        Removing an object from a view never deletes it from the model.
      </p>
    </div>
  );
}
