/**
 * Atlas CLI (§3.8A): `atlas validate`, `atlas diff`, `atlas export` — so the
 * file format is useful in CI. Pure functions here; bin/atlas.js is the shim.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  Workspace,
  WorkspaceLoadError,
  lintWorkspace,
  toMermaidC4,
  toPlantUmlC4,
  workspaceFromFiles,
  type FileMap,
} from "@atlas/core";
import { materialiseGitRef, parseGitRange } from "./git.js";

export function readWorkspaceDir(dir: string): FileMap {
  const files: FileMap = new Map();
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, rel);
      else if (entry.endsWith(".json")) files.set(rel, readFileSync(full, "utf8"));
    }
  };
  walk(dir, "");
  return files;
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateDir(dir: string): ValidateResult {
  let ws: Workspace;
  try {
    ws = workspaceFromFiles(readWorkspaceDir(dir));
  } catch (err) {
    if (err instanceof WorkspaceLoadError) {
      return { ok: false, errors: [err.message, ...err.issues], warnings: [] };
    }
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)], warnings: [] };
  }
  const warnings = lintWorkspace(ws).map((issue) => `${issue.code}: ${issue.message}`);
  return { ok: true, errors: [], warnings };
}

/** Semantic diff between two workspace directories, as readable lines. */
export function diffDirs(dirA: string, dirB: string): string[] {
  const a = workspaceFromFiles(readWorkspaceDir(dirA));
  const b = workspaceFromFiles(readWorkspaceDir(dirB));
  const lines: string[] = [];

  const compare = <T extends { id: string; name?: string }>(
    label: string,
    mapA: Map<string, T>,
    mapB: Map<string, T>,
    describe: (item: T, ws: Workspace) => string,
  ): void => {
    for (const [id, item] of [...mapB].sort()) {
      if (!mapA.has(id)) lines.push(`+ ${label} ${describe(item, b)}`);
    }
    for (const [id, item] of [...mapA].sort()) {
      if (!mapB.has(id)) lines.push(`- ${label} ${describe(item, a)}`);
    }
    for (const [id, itemA] of [...mapA].sort()) {
      const itemB = mapB.get(id);
      if (!itemB) continue;
      const jsonA = JSON.stringify(itemA);
      const jsonB = JSON.stringify(itemB);
      if (jsonA !== jsonB) {
        const changed = Object.keys({ ...itemA, ...itemB }).filter(
          (k) =>
            JSON.stringify((itemA as Record<string, unknown>)[k]) !==
            JSON.stringify((itemB as Record<string, unknown>)[k]),
        );
        lines.push(`~ ${label} ${describe(itemB, b)}: ${changed.join(", ")}`);
      }
    }
  };

  const relLabel = (r: { sourceId: string; targetId: string; name?: string }, ws: Workspace) =>
    `${ws.elements.get(r.sourceId)?.name ?? r.sourceId} → ${ws.elements.get(r.targetId)?.name ?? r.targetId}`;

  compare("element", a.elements, b.elements, (e) => `"${e.name}"`);
  compare("relationship", a.relationships, b.relationships, relLabel);
  compare("view", a.views, b.views, (v) => `"${v.name}"`);
  compare("state", a.states, b.states, (s) => `"${s.name}"`);
  return lines.length ? lines : ["No differences."];
}

export function exportView(dir: string, format: "mermaid" | "plantuml", viewName?: string): string {
  const ws = workspaceFromFiles(readWorkspaceDir(dir));
  const views = [...ws.views.values()];
  const view = viewName
    ? views.find((v) => v.name.toLowerCase() === viewName.toLowerCase())
    : views.find((v) => v.kind === "landscape") ?? views[0];
  if (!view) throw new Error(viewName ? `No view named "${viewName}"` : "Workspace has no views");
  return format === "mermaid" ? toMermaidC4(ws, view.id) : toPlantUmlC4(ws, view.id);
}

export function run(argv: string[]): number {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "validate": {
        const dir = rest[0] ?? ".";
        const result = validateDir(dir);
        for (const w of result.warnings) console.warn(`warning: ${w}`);
        if (!result.ok) {
          for (const e of result.errors) console.error(`error: ${e}`);
          return 1;
        }
        console.log(`OK — workspace at ${dir} is valid (${result.warnings.length} warning(s)).`);
        return 0;
      }
      case "diff": {
        if (rest[0] === "--git") {
          const [range, path] = rest.slice(1);
          const parsed = range ? parseGitRange(range) : null;
          if (!parsed) {
            console.error("usage: atlas diff --git <a>..<b> [path]");
            return 2;
          }
          const dirA = materialiseGitRef(process.cwd(), parsed.refA, path);
          const dirB = materialiseGitRef(process.cwd(), parsed.refB, path);
          for (const line of diffDirs(dirA, dirB)) console.log(line);
          return 0;
        }
        const [dirA, dirB] = rest;
        if (!dirA || !dirB) {
          console.error("usage: atlas diff <dirA> <dirB>  |  atlas diff --git <a>..<b> [path]");
          return 2;
        }
        for (const line of diffDirs(dirA, dirB)) console.log(line);
        return 0;
      }
      case "export": {
        const dir = rest[0];
        const format = (rest.find((a) => a.startsWith("--format="))?.split("=")[1] ?? "mermaid") as
          | "mermaid"
          | "plantuml";
        const viewName = rest.find((a) => a.startsWith("--view="))?.split("=")[1];
        if (!dir || !["mermaid", "plantuml"].includes(format)) {
          console.error("usage: atlas export <dir> [--format=mermaid|plantuml] [--view=<name>]");
          return 2;
        }
        console.log(exportView(dir, format, viewName));
        return 0;
      }
      default:
        console.error("usage: atlas <validate|diff|export> …");
        return 2;
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
