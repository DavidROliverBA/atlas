import { useState } from "react";
import {
  importArchimate,
  importStructurizr,
  toMermaidC4,
  toPlantUmlC4,
  toSvg,
  workspaceFromFiles,
  workspaceToFiles,
} from "@atlas/core";
import { useAtlas } from "../store";
import { autoLayoutCommands } from "../autolayout";
import { supabase } from "../supabase";
import { useSession } from "./AuthGate";

function download(filename: string, content: string, type: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Shown only when a GitHub SSO session exists (hosted deployment). */
function SignOutButton() {
  const session = useSession();
  if (!session) return null;
  const login = (session.user.user_metadata?.["user_name"] as string) ?? session.user.email;
  return (
    <button
      data-testid="sign-out"
      title={`Signed in as ${login}`}
      onClick={() => void supabase.auth.signOut().then(() => window.location.reload())}
      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50"
    >
      Sign out{login ? ` (${login})` : ""}
    </button>
  );
}

/** Tag colour overlay (§3.3): pick a tag, matching elements light up everywhere. */
function TagOverlaySelect() {
  const ws = useAtlas((s) => s.ws);
  useAtlas((s) => s.rev);
  const highlightTag = useAtlas((s) => s.highlightTag);
  const tags = [
    ...new Set([...ws.elements.values()].flatMap((e) => e.tags ?? [])),
  ].sort();
  if (!tags.length) return null;
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-500">
      Colour by tag
      <select
        data-testid="tag-overlay"
        className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-sm text-slate-700"
        value={highlightTag ?? ""}
        onChange={(e) => useAtlas.setState({ highlightTag: e.target.value || null })}
      >
        <option value="">off</option>
        {tags.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
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
  const source = useAtlas((s) => s.source);
  const connectDb = useAtlas((s) => s.connectDb);
  const disconnectDb = useAtlas((s) => s.disconnectDb);
  const syncDb = useAtlas((s) => s.syncDb);

  const slug = () => ws.meta.name.toLowerCase().replace(/\s+/g, "-");
  const viewSlug = () => ws.views.get(activeViewId)?.name.toLowerCase().replace(/\s+/g, "-") ?? "view";

  const exportBundle = () => {
    const files = Object.fromEntries(workspaceToFiles(ws));
    download(`${slug()}.atlas.json`, JSON.stringify({ atlasBundle: 1, files }, null, 2), "application/json");
  };

  const importBundle = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.xml";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        if (file.name.endsWith(".xml")) {
          // ArchiMate Open Exchange (best effort).
          const { workspace, warnings } = importArchimate(text, { next: () => useAtlas.getState().newId() });
          replaceWorkspace(workspace);
          if (warnings.length) {
            useAtlas.setState({ error: `Imported with ${warnings.length} warning(s): ${warnings[0]}` });
          }
          return;
        }
        const parsed = JSON.parse(text) as { files?: Record<string, string>; model?: unknown };
        if (parsed.files) {
          replaceWorkspace(workspaceFromFiles(new Map(Object.entries(parsed.files))));
        } else if (parsed.model) {
          // Structurizr JSON (best effort).
          const { workspace, warnings } = importStructurizr(parsed as never, {
            next: () => useAtlas.getState().newId(),
          });
          replaceWorkspace(workspace);
          if (warnings.length) {
            useAtlas.setState({ error: `Imported with ${warnings.length} warning(s): ${warnings[0]}` });
          }
        } else {
          throw new Error("Unrecognised file — expected an Atlas bundle, Structurizr JSON, or ArchiMate XML");
        }
      } catch (err) {
        useAtlas.setState({ error: err instanceof Error ? err.message : String(err) });
      }
    };
    input.click();
  };

  const exportPng = async () => {
    const svg = toSvg(ws, activeViewId);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not rasterise the view"));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${viewSlug()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
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
        data-testid="auto-layout"
        className={btn}
        title="Re-arrange the current view with ELK (layered); one undo step"
        onClick={() => {
          void autoLayoutCommands(ws, activeViewId).then((batch) => {
            if (batch) useAtlas.getState().dispatch(batch);
          });
        }}
      >
        Auto-layout
      </button>
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
              data-testid="export-png"
              className="px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              onClick={() => void exportPng()}
            >
              Current view as PNG
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
      <span className="mx-2 h-5 w-px bg-slate-200" />
      <TagOverlaySelect />
      <span className="flex-1" />
      <select
        data-testid="workspace-source"
        title="Where this workspace lives"
        className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-sm text-slate-700"
        value={source}
        onChange={(e) =>
          e.target.value === "db" ? void connectDb() : disconnectDb()
        }
      >
        <option value="local">Local workspace</option>
        <option value="db">Shared database</option>
      </select>
      {source === "db" && (
        <button data-testid="db-sync" className={btn} title="Pull the latest database state" onClick={() => void syncDb()}>
          Sync
        </button>
      )}
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
      <SignOutButton />
    </header>
  );
}
