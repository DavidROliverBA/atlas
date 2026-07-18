import type { Element, Ulid } from "@atlas/core";
import { C4_STENCILS } from "../stencils";
import { DEFAULT_H, DEFAULT_W, useAtlas } from "../store";

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

export function Palette() {
  const ws = useAtlas((s) => s.ws);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const dispatch = useAtlas((s) => s.dispatch);
  const select = useAtlas((s) => s.select);
  const newId = useAtlas((s) => s.newId);
  useAtlas((s) => s.rev);

  const addElement = (kind: Element["kind"]) => {
    const view = ws.views.get(activeViewId);
    if (!view) return;
    const parentId: Ulid | null = view.scopeId;
    const id = newId();
    const base = C4_STENCILS.find((s) => s.kind === kind)?.label ?? "Element";
    const siblings = [...ws.elements.values()].filter((e) => e.name.startsWith(`New ${base}`)).length;
    const name = siblings ? `New ${base} ${siblings + 1}` : `New ${base}`;
    const spot = freeSpot(view.placements);
    const error = dispatch({
      type: "batch",
      label: `Add ${base}`,
      commands: [
        { type: "createElement", element: { id, kind, name, parentId } },
        { type: "placeOnView", viewId: view.id, placement: { elementId: id, ...spot } },
      ],
    });
    if (!error) select({ type: "element", id });
  };

  return (
    <div className="border-b border-slate-200 p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        C4 stencils
      </h2>
      <div className="flex flex-col gap-1">
        {C4_STENCILS.map((s) => (
          <button
            key={s.kind}
            data-testid={`palette-${s.kind}`}
            title={s.hint}
            onClick={() => addElement(s.kind)}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-sm hover:border-slate-300 hover:bg-slate-50"
          >
            <span className={`h-3 w-3 rounded ${s.chipClass}`} />
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-400">
        Click to add to the current view. New objects join the model; removing them from a
        view never deletes them from the model.
      </p>
    </div>
  );
}
