/**
 * In-memory workspace: the single model behind every view.
 *
 * Mutation happens exclusively through the command bus (Architecture
 * Principle 2); the mutating methods here are the primitive operations the
 * command handlers call. Everything else on this class is a query.
 */

import type { Ulid } from "../ids.js";
import type {
  Element,
  NamedState,
  Relationship,
  View,
  WorkspaceData,
  WorkspaceMeta,
} from "../metamodel/types.js";

export class Workspace {
  meta: WorkspaceMeta;
  readonly elements = new Map<Ulid, Element>();
  readonly relationships = new Map<Ulid, Relationship>();
  readonly views = new Map<Ulid, View>();
  readonly states = new Map<Ulid, NamedState>();

  constructor(meta?: Partial<WorkspaceMeta>) {
    this.meta = { formatVersion: 1, name: meta?.name ?? "Untitled workspace", ...meta };
  }

  static fromData(data: WorkspaceData): Workspace {
    const ws = new Workspace(data.meta);
    for (const e of data.elements) ws.elements.set(e.id, e);
    for (const r of data.relationships) ws.relationships.set(r.id, r);
    for (const v of data.views) ws.views.set(v.id, v);
    for (const s of data.states) ws.states.set(s.id, s);
    return ws;
  }

  /** Plain-data snapshot with stable (id-sorted) collection order. */
  toData(): WorkspaceData {
    const byId = <T extends { id: string }>(m: Map<string, T>) =>
      [...m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      meta: this.meta,
      elements: byId(this.elements),
      relationships: byId(this.relationships),
      views: byId(this.views),
      states: byId(this.states),
    };
  }

  // ---- queries -----------------------------------------------------------

  element(id: Ulid): Element {
    const e = this.elements.get(id);
    if (!e) throw new Error(`Unknown element: ${id}`);
    return e;
  }

  relationship(id: Ulid): Relationship {
    const r = this.relationships.get(id);
    if (!r) throw new Error(`Unknown relationship: ${id}`);
    return r;
  }

  view(id: Ulid): View {
    const v = this.views.get(id);
    if (!v) throw new Error(`Unknown view: ${id}`);
    return v;
  }

  state(id: Ulid): NamedState {
    const s = this.states.get(id);
    if (!s) throw new Error(`Unknown state: ${id}`);
    return s;
  }

  children(parentId: Ulid | null): Element[] {
    return [...this.elements.values()].filter((e) => e.parentId === parentId);
  }

  /** Walk parentId links to the root. Throws on a containment cycle. */
  ancestors(id: Ulid): Element[] {
    const out: Element[] = [];
    const seen = new Set<Ulid>([id]);
    let current = this.element(id);
    while (current.parentId !== null) {
      if (seen.has(current.parentId)) {
        throw new Error(`Containment cycle at element ${current.parentId}`);
      }
      seen.add(current.parentId);
      current = this.element(current.parentId);
      out.push(current);
    }
    return out;
  }

  /**
   * The nearest non-group ancestor (or null for top level). Groups are
   * transparent for containment rules: a component inside a group inside a
   * container is still scoped to the container.
   */
  resolveScope(parentId: Ulid | null): Element | null {
    let cursor = parentId;
    const seen = new Set<Ulid>();
    while (cursor !== null) {
      if (seen.has(cursor)) throw new Error(`Containment cycle at element ${cursor}`);
      seen.add(cursor);
      const parent = this.element(cursor);
      if (parent.kind !== "group") return parent;
      cursor = parent.parentId;
    }
    return null;
  }

  /** All relationships with the given element as source or target. */
  relationshipsOf(elementId: Ulid): Relationship[] {
    return [...this.relationships.values()].filter(
      (r) => r.sourceId === elementId || r.targetId === elementId,
    );
  }

  /** Every view an element is placed on ("appears in"). */
  viewsContaining(elementId: Ulid): View[] {
    return [...this.views.values()].filter((v) =>
      v.placements.some((p) => p.elementId === elementId),
    );
  }
}
