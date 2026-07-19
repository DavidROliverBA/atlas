/**
 * Bidirectional mapping between Atlas model objects and the normalised
 * Postgres rows in schema.sql. Pure functions — the adapter and the
 * file↔DB sync both go through these, so a DB workspace exported to files
 * is byte-identical to one that never left the file format.
 */

import type {
  Element,
  NamedState,
  Relationship,
  View,
  WorkspaceData,
  WorkspaceMeta,
} from "@atlas/core";

export interface ElementRow {
  id: string;
  workspace_id: string;
  kind: Element["kind"];
  name: string;
  parent_id: string | null;
  description: string | null;
  documentation: string | null;
  team: string | null;
  status: string | null;
  criticality: string | null;
  technology: string[] | null;
  owners: string[] | null;
  tags: string[] | null;
  links: Element["links"] | null;
  properties: Element["properties"] | null;
  color: string | null;
  costs: Element["costs"] | null;
  stencil: Element["stencil"] | null;
  temporal: Element["temporal"] | null;
  state_overrides: Element["stateOverrides"] | null;
}

export interface RelationshipRow {
  id: string;
  workspace_id: string;
  source_id: string;
  target_id: string;
  name: string | null;
  description: string | null;
  direction: Relationship["direction"] | null;
  technology: string[] | null;
  tags: string[] | null;
  properties: Relationship["properties"] | null;
  color: string | null;
  temporal: Relationship["temporal"] | null;
}

export interface ViewRow {
  id: string;
  workspace_id: string;
  kind: View["kind"];
  name: string;
  scope_id: string | null;
  description: string | null;
  render_mode: View["renderMode"] | null;
  hidden_relationship_ids: string[] | null;
  edge_anchors: View["edgeAnchors"] | null;
}

export interface PlacementRow {
  view_id: string;
  element_id: string;
  /** Denormalised from the parent view so loads can filter per-workspace (§P2 gap fix). */
  workspace_id: string;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
}

export interface StateRow {
  id: string;
  workspace_id: string;
  name: string;
  date: string | null;
  description: string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  format_version: number;
  stencil_packs: string[];
}

const orNull = <T>(value: T | undefined): T | null => (value === undefined ? null : value);
const orUndef = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

export function elementToRow(e: Element, workspaceId: string): ElementRow {
  return {
    id: e.id,
    workspace_id: workspaceId,
    kind: e.kind,
    name: e.name,
    parent_id: e.parentId,
    description: orNull(e.description),
    documentation: orNull(e.documentation),
    team: orNull(e.team),
    status: orNull(e.status),
    criticality: orNull(e.criticality),
    technology: orNull(e.technology),
    owners: orNull(e.owners),
    tags: orNull(e.tags),
    links: orNull(e.links),
    properties: orNull(e.properties),
    color: orNull(e.color),
    costs: orNull(e.costs),
    stencil: orNull(e.stencil),
    temporal: orNull(e.temporal),
    state_overrides: orNull(e.stateOverrides),
  };
}

export function rowToElement(row: ElementRow): Element {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    parentId: row.parent_id,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.documentation !== null ? { documentation: row.documentation } : {}),
    ...(row.team !== null ? { team: row.team } : {}),
    ...(row.status !== null ? { status: row.status as Element["status"] } : {}),
    ...(row.criticality !== null ? { criticality: row.criticality as Element["criticality"] } : {}),
    ...(row.technology !== null ? { technology: row.technology } : {}),
    ...(row.owners !== null ? { owners: row.owners } : {}),
    ...(row.tags !== null ? { tags: row.tags } : {}),
    ...(row.links !== null ? { links: row.links } : {}),
    ...(row.properties !== null ? { properties: row.properties } : {}),
    ...(row.color !== null ? { color: row.color } : {}),
    ...(row.costs !== null ? { costs: row.costs } : {}),
    ...(row.stencil !== null ? { stencil: row.stencil } : {}),
    ...(row.temporal !== null ? { temporal: row.temporal } : {}),
    ...(row.state_overrides !== null ? { stateOverrides: row.state_overrides } : {}),
  };
}

export function relationshipToRow(r: Relationship, workspaceId: string): RelationshipRow {
  return {
    id: r.id,
    workspace_id: workspaceId,
    source_id: r.sourceId,
    target_id: r.targetId,
    name: orNull(r.name),
    description: orNull(r.description),
    direction: orNull(r.direction),
    technology: orNull(r.technology),
    tags: orNull(r.tags),
    properties: orNull(r.properties),
    color: orNull(r.color),
    temporal: orNull(r.temporal),
  };
}

export function rowToRelationship(row: RelationshipRow): Relationship {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    ...(row.name !== null ? { name: row.name } : {}),
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.direction !== null ? { direction: row.direction } : {}),
    ...(row.technology !== null ? { technology: row.technology } : {}),
    ...(row.tags !== null ? { tags: row.tags } : {}),
    ...(row.properties !== null ? { properties: row.properties } : {}),
    ...(row.color !== null ? { color: row.color } : {}),
    ...(row.temporal !== null ? { temporal: row.temporal } : {}),
  };
}

export function viewToRows(v: View, workspaceId: string): { view: ViewRow; placements: PlacementRow[] } {
  return {
    view: {
      id: v.id,
      workspace_id: workspaceId,
      kind: v.kind,
      name: v.name,
      scope_id: v.scopeId,
      description: orNull(v.description),
      render_mode: orNull(v.renderMode),
      hidden_relationship_ids: orNull(v.hiddenRelationshipIds),
      edge_anchors: orNull(v.edgeAnchors),
    },
    placements: v.placements.map((p) => ({
      view_id: v.id,
      element_id: p.elementId,
      workspace_id: workspaceId,
      x: p.x,
      y: p.y,
      width: orNull(p.width),
      height: orNull(p.height),
    })),
  };
}

export function rowsToView(row: ViewRow, placements: PlacementRow[]): View {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    scopeId: row.scope_id,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.render_mode !== null ? { renderMode: row.render_mode } : {}),
    placements: placements
      .filter((p) => p.view_id === row.id)
      .map((p) => ({
        elementId: p.element_id,
        x: p.x,
        y: p.y,
        ...(p.width !== null ? { width: p.width } : {}),
        ...(p.height !== null ? { height: p.height } : {}),
      })),
    ...(row.hidden_relationship_ids !== null
      ? { hiddenRelationshipIds: row.hidden_relationship_ids }
      : {}),
    ...(row.edge_anchors !== null ? { edgeAnchors: row.edge_anchors } : {}),
  };
}

export function stateToRow(s: NamedState, workspaceId: string): StateRow {
  return {
    id: s.id,
    workspace_id: workspaceId,
    name: s.name,
    date: orNull(s.date),
    description: orNull(s.description),
  };
}

export function rowToState(row: StateRow): NamedState {
  return {
    id: row.id,
    name: row.name,
    ...(row.date !== null ? { date: row.date } : {}),
    ...(row.description !== null ? { description: row.description } : {}),
  };
}

export function metaToRow(meta: WorkspaceMeta, id: string): WorkspaceRow {
  return {
    id,
    name: meta.name,
    description: orNull(meta.description),
    format_version: meta.formatVersion,
    stencil_packs: meta.stencilPacks ?? [],
  };
}

export function rowToMeta(row: WorkspaceRow): WorkspaceMeta {
  return {
    formatVersion: 1,
    name: row.name,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.stencil_packs.length ? { stencilPacks: row.stencil_packs } : {}),
  };
}

/** Whole-workspace conversion, used by the adapter and by file↔DB sync. */
export interface WorkspaceRows {
  workspace: WorkspaceRow;
  elements: ElementRow[];
  relationships: RelationshipRow[];
  views: ViewRow[];
  placements: PlacementRow[];
  states: StateRow[];
}

export function dataToRows(data: WorkspaceData, workspaceId: string): WorkspaceRows {
  const viewRows = data.views.map((v) => viewToRows(v, workspaceId));
  return {
    workspace: metaToRow(data.meta, workspaceId),
    elements: data.elements.map((e) => elementToRow(e, workspaceId)),
    relationships: data.relationships.map((r) => relationshipToRow(r, workspaceId)),
    views: viewRows.map((v) => v.view),
    placements: viewRows.flatMap((v) => v.placements),
    states: data.states.map((s) => stateToRow(s, workspaceId)),
  };
}

export function rowsToData(rows: WorkspaceRows): WorkspaceData {
  return {
    meta: rowToMeta(rows.workspace),
    elements: rows.elements.map(rowToElement),
    relationships: rows.relationships.map(rowToRelationship),
    views: rows.views.map((v) => rowsToView(v, rows.placements)),
    states: rows.states.map(rowToState),
  };
}
