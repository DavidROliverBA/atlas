/**
 * Workspace ⇄ files mapping (§3.8A).
 *
 * Layout (paths relative to the workspace directory):
 *   atlas.workspace.json          — manifest
 *   model/elements/<id>.json      — one file per element
 *   model/relationships/<id>.json — one file per relationship
 *   views/<id>.json
 *   states/<id>.json
 *
 * The mapping is pure data-in/data-out (a Map of path → content); actual
 * disk/File System Access/zip IO lives in the storage adapters.
 */

import type {
  Element,
  NamedState,
  Relationship,
  Temporal,
  View,
  WorkspaceData,
} from "../metamodel/types.js";
import { Workspace } from "../model/workspace.js";
import { dropEmpty, sortedSet, stringifyCanonical } from "./canonical.js";
import { validateFile, type FileKind } from "../schemas/validate.js";

export const MANIFEST_PATH = "atlas.workspace.json";
export const ELEMENTS_DIR = "model/elements";
export const RELATIONSHIPS_DIR = "model/relationships";
export const VIEWS_DIR = "views";
export const STATES_DIR = "states";

export type FileMap = Map<string, string>;

function normaliseTemporal(t: Temporal | undefined): Temporal | undefined {
  if (!t) return undefined;
  const out: Temporal = {};
  if (t.validFrom) out.validFrom = t.validFrom;
  if (t.validTo) out.validTo = t.validTo;
  const states = sortedSet(t.states);
  if (states) out.states = states;
  return dropEmpty(out);
}

function normaliseElement(e: Element): Element {
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    parentId: e.parentId,
    description: e.description || undefined,
    documentation: e.documentation || undefined,
    technology: dropEmpty(e.technology),
    owners: dropEmpty(e.owners),
    team: e.team || undefined,
    status: e.status,
    criticality: e.criticality,
    tags: sortedSet(e.tags),
    links: dropEmpty(e.links),
    properties: dropEmpty(e.properties),
    color: e.color,
    stencil: e.stencil,
    temporal: normaliseTemporal(e.temporal),
    stateOverrides: dropEmpty(e.stateOverrides),
  };
}

function normaliseRelationship(r: Relationship): Relationship {
  return {
    id: r.id,
    sourceId: r.sourceId,
    targetId: r.targetId,
    name: r.name || undefined,
    description: r.description || undefined,
    technology: dropEmpty(r.technology),
    direction: r.direction,
    tags: sortedSet(r.tags),
    properties: dropEmpty(r.properties),
    color: r.color,
    temporal: normaliseTemporal(r.temporal),
  };
}

function normaliseView(v: View): View {
  return {
    id: v.id,
    kind: v.kind,
    name: v.name,
    scopeId: v.scopeId,
    description: v.description || undefined,
    renderMode: v.renderMode,
    placements: [...v.placements]
      .sort((a, b) => (a.elementId < b.elementId ? -1 : 1))
      .map((p) => ({
        elementId: p.elementId,
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
      })),
    hiddenRelationshipIds: sortedSet(v.hiddenRelationshipIds),
    edgeAnchors: dropEmpty(v.edgeAnchors),
  };
}

function normaliseState(s: NamedState): NamedState {
  return { id: s.id, name: s.name, date: s.date, description: s.description || undefined };
}

/** Serialise a workspace to its canonical file map, sorted by path. */
export function workspaceToFiles(ws: Workspace): FileMap {
  const data = ws.toData();
  const files: Array<[string, string]> = [];

  files.push([
    MANIFEST_PATH,
    stringifyCanonical({
      formatVersion: data.meta.formatVersion,
      name: data.meta.name,
      description: data.meta.description || undefined,
      stencilPacks: dropEmpty(data.meta.stencilPacks ? [...data.meta.stencilPacks].sort() : undefined),
    }),
  ]);
  for (const e of data.elements) {
    files.push([`${ELEMENTS_DIR}/${e.id}.json`, stringifyCanonical(normaliseElement(e))]);
  }
  for (const r of data.relationships) {
    files.push([`${RELATIONSHIPS_DIR}/${r.id}.json`, stringifyCanonical(normaliseRelationship(r))]);
  }
  for (const v of data.views) {
    files.push([`${VIEWS_DIR}/${v.id}.json`, stringifyCanonical(normaliseView(v))]);
  }
  for (const s of data.states) {
    files.push([`${STATES_DIR}/${s.id}.json`, stringifyCanonical(normaliseState(s))]);
  }

  files.sort(([a], [b]) => (a < b ? -1 : 1));
  return new Map(files);
}

export class WorkspaceLoadError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "WorkspaceLoadError";
  }
}

function parseFile<T>(path: string, content: string, kind: FileKind): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new WorkspaceLoadError(`Invalid JSON in ${path}: ${(err as Error).message}`, path);
  }
  const issues = validateFile(kind, parsed);
  if (issues.length) {
    throw new WorkspaceLoadError(`Schema validation failed for ${path}`, path, issues);
  }
  return parsed as T;
}

/**
 * Load a workspace from a file map, validating every file against its JSON
 * Schema and checking referential integrity.
 */
export function workspaceFromFiles(files: FileMap): Workspace {
  const manifestRaw = files.get(MANIFEST_PATH);
  if (!manifestRaw) {
    throw new WorkspaceLoadError(`Missing ${MANIFEST_PATH} — not an Atlas workspace`, MANIFEST_PATH);
  }
  const meta = parseFile<WorkspaceData["meta"]>(MANIFEST_PATH, manifestRaw, "workspace");

  const data: WorkspaceData = { meta, elements: [], relationships: [], views: [], states: [] };
  for (const [path, content] of files) {
    if (path === MANIFEST_PATH) continue;
    if (path.startsWith(`${ELEMENTS_DIR}/`)) {
      data.elements.push(parseFile<Element>(path, content, "element"));
    } else if (path.startsWith(`${RELATIONSHIPS_DIR}/`)) {
      data.relationships.push(parseFile<Relationship>(path, content, "relationship"));
    } else if (path.startsWith(`${VIEWS_DIR}/`)) {
      data.views.push(parseFile<View>(path, content, "view"));
    } else if (path.startsWith(`${STATES_DIR}/`)) {
      data.states.push(parseFile<NamedState>(path, content, "state"));
    }
    // Unknown paths (e.g. stencils/, README) are ignored, not errors.
  }

  const ws = Workspace.fromData(data);
  checkIntegrity(ws);
  return ws;
}

/** Referential integrity: every id referenced by anything must exist. */
export function checkIntegrity(ws: Workspace): void {
  const problems: string[] = [];
  for (const e of ws.elements.values()) {
    if (e.parentId !== null && !ws.elements.has(e.parentId)) {
      problems.push(`Element ${e.id} ("${e.name}") has unknown parent ${e.parentId}`);
    }
    for (const stateId of e.temporal?.states ?? []) {
      if (!ws.states.has(stateId)) problems.push(`Element ${e.id} references unknown state ${stateId}`);
    }
    for (const stateId of Object.keys(e.stateOverrides ?? {})) {
      if (!ws.states.has(stateId)) problems.push(`Element ${e.id} has overrides for unknown state ${stateId}`);
    }
  }
  for (const r of ws.relationships.values()) {
    if (!ws.elements.has(r.sourceId)) problems.push(`Relationship ${r.id} has unknown source ${r.sourceId}`);
    if (!ws.elements.has(r.targetId)) problems.push(`Relationship ${r.id} has unknown target ${r.targetId}`);
    for (const stateId of r.temporal?.states ?? []) {
      if (!ws.states.has(stateId)) problems.push(`Relationship ${r.id} references unknown state ${stateId}`);
    }
  }
  for (const v of ws.views.values()) {
    if (v.scopeId !== null && !ws.elements.has(v.scopeId)) {
      problems.push(`View ${v.id} ("${v.name}") has unknown scope ${v.scopeId}`);
    }
    for (const p of v.placements) {
      if (!ws.elements.has(p.elementId)) {
        problems.push(`View ${v.id} places unknown element ${p.elementId}`);
      }
    }
    for (const relId of v.hiddenRelationshipIds ?? []) {
      if (!ws.relationships.has(relId)) problems.push(`View ${v.id} hides unknown relationship ${relId}`);
    }
    for (const relId of Object.keys(v.edgeAnchors ?? {})) {
      if (!ws.relationships.has(relId)) {
        problems.push(`View ${v.id} anchors unknown relationship ${relId}`);
      }
    }
  }
  if (problems.length) {
    throw new WorkspaceLoadError(
      `Workspace failed integrity checks (${problems.length} problem${problems.length === 1 ? "" : "s"})`,
      "",
      problems,
    );
  }
}
