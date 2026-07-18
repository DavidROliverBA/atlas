import type { Element } from "@atlas/core";
import { VIEW_PLACEMENT } from "@atlas/core";
import { stencilFor } from "../stencils";
import { useAtlas } from "../store";
import { freeSpot } from "./Palette";

function TreeNode({ element, depth }: { element: Element; depth: number }) {
  const ws = useAtlas((s) => s.ws);
  const selection = useAtlas((s) => s.selection);
  const select = useAtlas((s) => s.select);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const dispatch = useAtlas((s) => s.dispatch);

  const children = ws.children(element.id).sort((a, b) => a.name.localeCompare(b.name));
  const selected = selection?.type === "element" && selection.id === element.id;
  const view = ws.views.get(activeViewId);
  const onActiveView = view?.placements.some((p) => p.elementId === element.id) ?? false;
  const onAnyView = ws.viewsContaining(element.id).length > 0;

  return (
    <div>
      <div
        data-testid={`tree-${element.name}`}
        onClick={() => select({ type: "element", id: element.id })}
        className={`group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm ${
          selected ? "bg-blue-100 text-blue-900" : "hover:bg-slate-100"
        }`}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${stencilFor(element.kind).chipClass}`} />
        <span className="truncate">{element.name}</span>
        {!onAnyView && (
          <span title="Not on any view (orphan)" className="ml-auto text-[10px] text-orange-400">
            ●
          </span>
        )}
        {!onActiveView && view && element.kind !== "group" && VIEW_PLACEMENT[view.kind].includes(element.kind) && (
          <button
            title="Place on current view"
            data-testid={`place-${element.name}`}
            onClick={(e) => {
              e.stopPropagation();
              dispatch({
                type: "placeOnView",
                viewId: view.id,
                placement: { elementId: element.id, ...freeSpot(view.placements) },
              });
            }}
            className={`${onAnyView ? "ml-auto" : ""} hidden rounded bg-slate-200 px-1 text-[10px] text-slate-600 group-hover:block`}
          >
            + place
          </button>
        )}
      </div>
      {children.map((c) => (
        <TreeNode key={c.id} element={c} depth={depth + 1} />
      ))}
    </div>
  );
}

export function ModelTree() {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const setActiveView = useAtlas((s) => s.setActiveView);
  const dispatchTop = useAtlas((s) => s.dispatch);

  const roots = ws.children(null).sort((a, b) => a.name.localeCompare(b.name));
  const views = [...ws.views.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Model</h2>
      <div data-testid="model-tree">
        {roots.map((e) => (
          <TreeNode key={e.id} element={e} depth={0} />
        ))}
      </div>
      <div className="mb-2 mt-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Views</h2>
        <button
          data-testid="view-new"
          title="Create a new view"
          onClick={() => {
            const name = window.prompt("Name for the new view:", "New view");
            if (!name?.trim()) return;
            const id = useAtlas.getState().newId();
            const error = dispatchTop({
              type: "createView",
              view: { id, kind: "custom", name: name.trim(), scopeId: null, placements: [] },
            });
            if (!error) setActiveView(id);
          }}
          className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200"
        >
          + New
        </button>
      </div>
      <div data-testid="view-list">
        {views.map((v) => (
          <div
            key={v.id}
            data-testid={`view-${v.name}`}
            onClick={() => {
              useAtlas.setState({ navDirection: null });
              setActiveView(v.id);
            }}
            className={`group flex cursor-pointer items-center gap-1 truncate rounded px-1.5 py-1 text-sm ${
              v.id === activeViewId ? "bg-blue-100 text-blue-900" : "hover:bg-slate-100"
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{v.name}</span>
            <button
              data-testid={`view-rename-${v.name}`}
              title="Rename view"
              onClick={(e) => {
                e.stopPropagation();
                const name = window.prompt("Rename view:", v.name);
                if (name?.trim() && name.trim() !== v.name) {
                  dispatchTop({ type: "updateView", id: v.id, changes: { name: name.trim() } });
                }
              }}
              className="hidden rounded px-1 text-[11px] text-slate-500 hover:bg-slate-200 group-hover:block"
            >
              ✎
            </button>
            <button
              data-testid={`view-delete-${v.name}`}
              title="Delete view (the model is untouched)"
              onClick={(e) => {
                e.stopPropagation();
                if (!window.confirm(`Delete view "${v.name}"? Elements stay in the model.`)) return;
                const wasActive = v.id === activeViewId;
                const error = dispatchTop({ type: "deleteView", id: v.id });
                if (!error && wasActive) {
                  const remaining = [...useAtlas.getState().ws.views.values()];
                  const fallback = remaining.find((x) => x.kind === "landscape") ?? remaining[0];
                  if (fallback) setActiveView(fallback.id);
                }
              }}
              className="hidden rounded px-1 text-[11px] text-slate-500 hover:bg-red-100 hover:text-red-600 group-hover:block"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
