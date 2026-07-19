import { Suspense, lazy, useEffect, useState } from "react";
import { useAtlas } from "./store";
import { Toolbar } from "./components/Toolbar";
import { Palette } from "./components/Palette";
import { ModelTree } from "./components/ModelTree";
import { Canvas } from "./components/Canvas";
import { Inspector } from "./components/Inspector";
import { Breadcrumbs } from "./components/Breadcrumbs";
import { ModeToggle } from "./components/ModeToggle";
import { ConnectionsView } from "./components/ConnectionsView";
import { AnalysisDrawer } from "./components/AnalysisDrawer";
import { HelpPanel } from "./components/HelpPanel";
import { TimelineBar } from "./components/TimelineBar";
import { CommandPalette } from "./components/CommandPalette";

// ChatPanel pulls in @atlas/ai (and, transitively, @anthropic-ai/sdk) — a
// sizeable dependency only needed once the user opens the AI chat tab, so
// it's split into its own chunk instead of loading with the initial bundle.
const ChatPanel = lazy(() => import("./components/ChatPanel").then((m) => ({ default: m.ChatPanel })));

function Toast() {
  const error = useAtlas((s) => s.error);
  const clearError = useAtlas((s) => s.clearError);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 5000);
    return () => clearTimeout(t);
  }, [error, clearError]);
  if (!error) return null;
  return (
    <div
      data-testid="toast-error"
      onClick={clearError}
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 cursor-pointer rounded-lg bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
    >
      {error}
    </div>
  );
}

export default function App() {
  const undo = useAtlas((s) => s.undo);
  const redo = useAtlas((s) => s.redo);
  const overlay = useAtlas((s) => s.overlay);
  const source = useAtlas((s) => s.source);

  // Database mode: poll for remote changes so other clients' edits appear.
  useEffect(() => {
    if (source !== "db") return;
    const interval = setInterval(() => {
      if (!document.hidden) void useAtlas.getState().syncDb();
    }, 8000);
    return () => clearInterval(interval);
  }, [source]);
  const [rightTab, setRightTab] = useState<"inspector" | "chat">("inspector");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const meta = e.metaKey || e.ctrlKey;
      const { ws, selection, activeViewId, dispatch, select } = useAtlas.getState();

      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useAtlas.setState((s) => ({ paletteOpen: !s.paletteOpen }));
        return;
      }
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === "Escape") {
        select(null);
        return;
      }
      // Delete removes from the *view* (never the model — that's the inspector's
      // explicit, confirmed action). For relationships it deletes the relationship.
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selection) return;
        e.preventDefault();
        if (selection.type === "element") {
          const view = ws.views.get(activeViewId);
          if (view?.placements.some((p) => p.elementId === selection.id)) {
            dispatch({ type: "removeFromView", viewId: activeViewId, elementId: selection.id });
            select(null);
          }
        } else {
          dispatch({ type: "deleteRelationship", id: selection.id });
          select(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-900">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white">
          <Palette />
          <ModelTree />
        </aside>
        <main className="relative min-w-0 flex-1">
          <Breadcrumbs />
          <ModeToggle />
          <Canvas />
          {overlay?.type === "analysis" && (
            <AnalysisDrawer onClose={() => useAtlas.setState({ overlay: null })} />
          )}
          {overlay?.type === "help" && (
            <HelpPanel onClose={() => useAtlas.setState({ overlay: null })} />
          )}
        </main>
        <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="flex border-b border-slate-200">
            {(["inspector", "chat"] as const).map((tab) => (
              <button
                key={tab}
                data-testid={`right-tab-${tab}`}
                onClick={() => setRightTab(tab)}
                className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                  rightTab === tab
                    ? "border-b-2 border-blue-500 text-slate-800"
                    : "text-slate-400 hover:text-slate-600"
                }`}
              >
                {tab === "inspector" ? "Inspector" : "AI chat"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {rightTab === "inspector" ? (
              <Inspector />
            ) : (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-xs text-slate-400" data-testid="chat-panel-loading">
                    Loading AI assistant…
                  </div>
                }
              >
                <ChatPanel />
              </Suspense>
            )}
          </div>
        </aside>
      </div>
      <TimelineBar />
      {overlay?.type === "connections" && (
        <ConnectionsView centerId={overlay.id} onClose={() => useAtlas.setState({ overlay: null })} />
      )}
      <CommandPalette />
      <Toast />
    </div>
  );
}
