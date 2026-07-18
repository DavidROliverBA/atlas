import type { Element } from "@atlas/core";
import { useAtlas } from "../store";

/**
 * Zoom-out navigation: Landscape / [ancestor systems] / current scope.
 * Clicking a crumb navigates to that level's view with a zoom-out animation.
 */
export function Breadcrumbs() {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const setActiveView = useAtlas((s) => s.setActiveView);
  const drillInto = useAtlas((s) => s.drillInto);

  const view = ws.views.get(activeViewId);
  if (!view) return null;

  const landscape = [...ws.views.values()].find((v) => v.kind === "landscape");

  const chain: Element[] = [];
  if (view.scopeId && ws.elements.has(view.scopeId)) {
    const scope = ws.element(view.scopeId);
    chain.push(...ws.ancestors(scope.id).reverse().filter((a) => a.kind !== "group"), scope);
  }

  const crumb =
    "max-w-40 truncate rounded px-1.5 py-0.5 text-sm text-slate-600 hover:bg-slate-200";

  return (
    <nav
      data-testid="breadcrumbs"
      className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-2 py-1 shadow-sm"
    >
      {landscape && (
        <button
          data-testid="crumb-landscape"
          className={`${crumb} ${!view.scopeId ? "font-semibold text-slate-900" : ""}`}
          onClick={() => {
            useAtlas.setState({ navDirection: "out" });
            setActiveView(landscape.id);
          }}
        >
          {landscape.name}
        </button>
      )}
      {chain.map((el, i) => {
        const isLast = i === chain.length - 1;
        return (
          <span key={el.id} className="flex items-center gap-1">
            <span className="text-slate-300">/</span>
            <button
              data-testid={`crumb-${el.name}`}
              className={`${crumb} ${isLast ? "font-semibold text-slate-900" : ""}`}
              onClick={() => {
                if (isLast) return;
                const target = drillInto(el.id);
                if (target) {
                  useAtlas.setState({ navDirection: "out" });
                  setActiveView(target);
                }
              }}
            >
              {el.name}
            </button>
          </span>
        );
      })}
      <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
        {view.kind}
      </span>
    </nav>
  );
}
