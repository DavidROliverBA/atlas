import { useState } from "react";
import { toMermaidC4, toPlantUmlC4, toSvg, workspaceFromFiles, workspaceToFiles } from "@atlas/core";
import { useAtlas } from "../store";

function download(filename: string, content: string, type: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Toolbar() {
  const ws = useAtlas((s) => s.ws);
  const bus = useAtlas((s) => s.bus);
  const activeViewId = useAtlas((s) => s.activeViewId);
  const [exportOpen, setExportOpen] = useState(false);
  useAtlas((s) => s.rev);
  const undo = useAtlas((s) => s.undo);
  const redo = useAtlas((s) => s.redo);
  const resetToDemo = useAtlas((s) => s.resetToDemo);
  const replaceWorkspace = useAtlas((s) => s.replaceWorkspace);

  const slug = () => ws.meta.name.toLowerCase().replace(/\s+/g, "-");
  const viewSlug = () => ws.views.get(activeViewId)?.name.toLowerCase().replace(/\s+/g, "-") ?? "view";

  const exportBundle = () => {
    const files = Object.fromEntries(workspaceToFiles(ws));
    download(`${slug()}.atlas.json`, JSON.stringify({ atlasBundle: 1, files }, null, 2), "application/json");
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
      <div className="relative">
        <button data-testid="export" className={btn} onClick={() => setExportOpen((o) => !o)}>
          Export ▾
        </button>
        {exportOpen && (
          <div
            data-testid="export-menu"
            className="absolute left-0 top-9 z-30 flex w-52 flex-col rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            onClick={() => setExportOpen(false)}
          >
            <button data-testid="export-bundle" className="px-3 py-1.5 text-left text-sm hover:bg-slate-50" onClick={exportBundle}>
              Workspace bundle (.json)
            </button>
            <button
              data-testid="export-svg"
              className="px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              onClick={() => download(`${viewSlug()}.svg`, toSvg(ws, activeViewId), "image/svg+xml")}
            >
              Current view as SVG
            </button>
            <button
              data-testid="export-mermaid"
              className="px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              onClick={() => download(`${viewSlug()}.mmd`, toMermaidC4(ws, activeViewId), "text/plain")}
            >
              Current view as Mermaid C4
            </button>
            <button
              data-testid="export-plantuml"
              className="px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              onClick={() => download(`${viewSlug()}.puml`, toPlantUmlC4(ws, activeViewId), "text/plain")}
            >
              Current view as PlantUML C4
            </button>
          </div>
        )}
      </div>
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
