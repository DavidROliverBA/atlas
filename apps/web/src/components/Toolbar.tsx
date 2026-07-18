import { workspaceFromFiles, workspaceToFiles } from "@atlas/core";
import { useAtlas } from "../store";

export function Toolbar() {
  const ws = useAtlas((s) => s.ws);
  const bus = useAtlas((s) => s.bus);
  useAtlas((s) => s.rev);
  const undo = useAtlas((s) => s.undo);
  const redo = useAtlas((s) => s.redo);
  const resetToDemo = useAtlas((s) => s.resetToDemo);
  const replaceWorkspace = useAtlas((s) => s.replaceWorkspace);

  const exportBundle = () => {
    const files = Object.fromEntries(workspaceToFiles(ws));
    const blob = new Blob([JSON.stringify({ atlasBundle: 1, files }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${ws.meta.name.toLowerCase().replace(/\s+/g, "-")}.atlas.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importBundle = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text()) as { files?: Record<string, string> };
        if (!parsed.files) throw new Error("Not an Atlas bundle (missing files map)");
        replaceWorkspace(workspaceFromFiles(new Map(Object.entries(parsed.files))));
      } catch (err) {
        useAtlas.setState({ error: err instanceof Error ? err.message : String(err) });
      }
    };
    input.click();
  };

  const btn =
    "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white";

  return (
    <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
      <span className="mr-2 text-base font-bold tracking-tight text-slate-800">
        Atlas <span className="text-xs font-normal text-slate-400">architecture modelling</span>
      </span>
      <button data-testid="undo" className={btn} onClick={undo} disabled={!bus.canUndo} title="Undo (⌘Z)">
        ↩ Undo
      </button>
      <button data-testid="redo" className={btn} onClick={redo} disabled={!bus.canRedo} title="Redo (⇧⌘Z)">
        ↪ Redo
      </button>
      <span className="mx-2 h-5 w-px bg-slate-200" />
      <button
        data-testid="open-analysis"
        className={btn}
        onClick={() => useAtlas.setState({ overlay: { type: "analysis" } })}
      >
        Analysis
      </button>
      <span className="mx-2 h-5 w-px bg-slate-200" />
      <button data-testid="export" className={btn} onClick={exportBundle}>
        Export
      </button>
      <button data-testid="import" className={btn} onClick={importBundle}>
        Import
      </button>
      <span className="flex-1" />
      <span className="truncate text-sm text-slate-500" data-testid="workspace-name">
        {ws.meta.name}
      </span>
      <button
        data-testid="reset-demo"
        className={btn}
        onClick={() => window.confirm("Replace the current workspace with the demo estate?") && resetToDemo()}
      >
        Reset demo
      </button>
    </header>
  );
}
