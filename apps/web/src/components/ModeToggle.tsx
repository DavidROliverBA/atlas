import { useAtlas } from "../store";

/** 2D ⇄ isometric toggle — a render mode on the view, not a separate diagram. */
export function ModeToggle() {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const dispatch = useAtlas((s) => s.dispatch);

  const view = ws.views.get(activeViewId);
  if (!view) return null;
  const mode = view.renderMode === "isometric" ? "iso" : "2d";

  const btn = (active: boolean) =>
    `rounded px-2 py-0.5 text-sm ${active ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-200"}`;

  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-1.5 py-1 shadow-sm">
      <button
        data-testid="mode-2d"
        className={btn(mode === "2d")}
        onClick={() => mode !== "2d" && dispatch({ type: "updateView", id: view.id, changes: { renderMode: null as never } })}
      >
        2D
      </button>
      <button
        data-testid="mode-iso"
        className={btn(mode === "iso")}
        onClick={() =>
          mode !== "iso" && dispatch({ type: "updateView", id: view.id, changes: { renderMode: "isometric" } })
        }
      >
        Iso
      </button>
    </div>
  );
}
