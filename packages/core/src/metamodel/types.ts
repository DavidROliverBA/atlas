/**
 * The Atlas metamodel: typed model objects that exist independently of any
 * diagram. Views are projections of the model (Architecture Principle 1).
 */

import type { Ulid } from "../ids.js";

/** ISO calendar date, e.g. "2026-07-18". Temporal validity is date-grained in v1. */
export type IsoDate = string;

/**
 * The built-in C4 element kinds. Stencil packs map their stencils onto one of
 * these kinds (Extension over enumeration — new domains arrive as packs, not
 * new hard-coded kinds).
 */
export type ElementKind = "person" | "system" | "container" | "component" | "group";

export const ELEMENT_KINDS: readonly ElementKind[] = [
  "person",
  "system",
  "container",
  "component",
  "group",
];

export type Lifecycle =
  | "proposed"
  | "planned"
  | "live"
  | "deprecated"
  | "decommissioned";

export type Criticality = "low" | "medium" | "high" | "critical";

export interface ExternalLink {
  title: string;
  url: string;
}

/**
 * Temporal validity and named-state membership (§3.6).
 * - `validFrom`/`validTo` bound the dates at which the object exists.
 * - `states` is explicit membership in named states; when present it takes
 *   precedence over date evaluation for state-based contexts.
 */
export interface Temporal {
  validFrom?: IsoDate;
  validTo?: IsoDate;
  states?: Ulid[];
}

/** Fixed cost-category perimeter (§TCO plan) — not user-extensible in v1. */
export type CostCategory =
  | "licences"
  | "infrastructure"
  | "people"
  | "vendor-services"
  | "change"
  | "decommission"
  | "other";

export type CostClassification = "run" | "change" | "acquire" | "retire";

export type CostConfidence = "estimate" | "quoted" | "actual";

/** A single line of cost attached to an element (or group), for TCO roll-up. */
export interface CostEntry {
  id: Ulid;
  label: string;
  category: CostCategory;
  classification: CostClassification;
  kind: "recurring" | "one-off";
  /** Positive amount in whole currency units. */
  amount: number;
  /** ISO 4217, default "GBP" when omitted. */
  currency?: string;
  /** Recurring only; default "annual". */
  period?: "monthly" | "annual";
  /** One-off only; straight-line amortisation, default 3. */
  amortiseYears?: number;
  confidence?: CostConfidence;
  /** Same semantics as Temporal on elements. */
  validFrom?: IsoDate;
  validTo?: IsoDate;
  states?: Ulid[];
}

/** Reference to the stencil an element was created from, plus its pack-specific attributes. */
export interface StencilRef {
  pack: string;
  stencil: string;
  attributes?: Record<string, unknown>;
}

/** Attribute overrides applied when viewing the model in a given named state. */
export type StateOverride = Partial<
  Pick<Element, "name" | "description" | "technology" | "status" | "tags">
>;

export interface Element {
  id: Ulid;
  kind: ElementKind;
  name: string;
  /** Containment is a model property; the C4 hierarchy lives here, not in diagrams. */
  parentId: Ulid | null;
  /** Short display description. */
  description?: string;
  /** Long description, Markdown. */
  documentation?: string;
  technology?: string[];
  owners?: string[];
  team?: string;
  status?: Lifecycle;
  criticality?: Criticality;
  tags?: string[];
  /** Reality links: repos, cloud consoles, docs, ADRs. */
  links?: ExternalLink[];
  /** Free-form key–value properties. */
  properties?: Record<string, string>;
  /** Custom box colour (hex, e.g. "#0ea5e9"); overrides the kind/stencil default. */
  color?: string;
  costs?: CostEntry[];
  stencil?: StencilRef;
  temporal?: Temporal;
  /** Keyed by state id. */
  stateOverrides?: Record<Ulid, StateOverride>;
}

export type RelationshipDirection = "forward" | "bidirectional";

export interface Relationship {
  id: Ulid;
  sourceId: Ulid;
  targetId: Ulid;
  /** Verb phrase, e.g. "publishes booking events to". */
  name?: string;
  description?: string;
  technology?: string[];
  direction?: RelationshipDirection;
  tags?: string[];
  properties?: Record<string, string>;
  /** Custom line colour (hex). */
  color?: string;
  temporal?: Temporal;
}

export type ViewKind = "landscape" | "context" | "container" | "component" | "custom";
export type RenderMode = "2d" | "isometric";

/**
 * Per-view position of an element, in 2D grid coordinates. The isometric
 * renderer projects these same coordinates; there is no separate iso layout.
 */
export interface Placement {
  elementId: Ulid;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface View {
  id: Ulid;
  kind: ViewKind;
  name: string;
  /**
   * The element this view is scoped to (the system for a container view, the
   * container for a component view). Null for landscape and custom views.
   */
  scopeId: Ulid | null;
  description?: string;
  renderMode?: RenderMode;
  placements: Placement[];
  /**
   * Relationships explicitly hidden on this view. By default every
   * relationship whose endpoints are both placed is shown.
   */
  hiddenRelationshipIds?: Ulid[];
  /**
   * Per-view routing: which connection ports a relationship's line is pinned
   * to on this view (port ids: t0–t4, b0–b4, l0–l2, r0–r2). Relationships
   * without an entry are auto-routed: aligned boxes get straight lines via
   * facing mid-ports.
   */
  edgeAnchors?: Record<Ulid, { source: string; target: string }>;
}

/** A named state such as "Current", "Q4 2026 Transition" or "Target 2028". */
export interface NamedState {
  id: Ulid;
  name: string;
  /** Optional date anchor; undated states are purely logical. */
  date?: IsoDate;
  /** Explicit display/comparison order; lower sorts first. States without one sort after those with. */
  order?: number;
  description?: string;
}

export interface WorkspaceMeta {
  formatVersion: 1;
  name: string;
  description?: string;
  /** Enabled stencil pack ids, e.g. "c4-core@1". */
  stencilPacks?: string[];
}

/** Plain-data snapshot of a whole workspace (what gets serialised). */
export interface WorkspaceData {
  meta: WorkspaceMeta;
  elements: Element[];
  relationships: Relationship[];
  views: View[];
  states: NamedState[];
}
