import { useEffect } from "react";
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
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
        </main>
        <aside className="w-80 shrink-0 border-l border-slate-200 bg-white">
          <Inspector />
        </aside>
      </div>
      {overlay?.type === "connections" && (
        <ConnectionsView centerId={overlay.id} onClose={() => useAtlas.setState({ overlay: null })} />
      )}
      <Toast />
    </div>
  );
}
