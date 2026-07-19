/**
 * Change-set builder: translates AI tool calls into ordinary Atlas commands.
 *
 * The AI never mutates the live workspace. Tool calls execute against a
 * *planning clone* (so later calls can reference earlier creations and get
 * real validation errors), while the equivalent commands accumulate into a
 * change set. Applying the change set later is one `batch` dispatch on the
 * real bus — identical validation, single undo step (brief §3.7).
 */

import {
  CommandBus,
  Workspace,
  estateTco,
  elementAnnual,
  tcoDiff,
  type Command,
  type CommandBusOptions,
  type CostEntry,
  type Element,
  type ElementKind,
  type NamedState,
  type Placement,
  type Relationship,
  type RelationshipDirection,
  type StateOverride,
  type StencilRef,
  type TcoRow,
  type TemporalContext,
  type Ulid,
  type UlidFactory,
  type View,
  type ViewKind,
} from "@atlas/core";

export interface ChangeSummaryItem {
  kind: "element" | "relationship" | "view" | "placement" | "update" | "state";
  description: string;
}

export class ToolError extends Error {}

/** Valid per-view connection ports (mirrors apps/web/src/ports.ts): 5 along top/bottom, 3 on each side. */
const VALID_PORTS = new Set([
  "t0", "t1", "t2", "t3", "t4",
  "b0", "b1", "b2", "b3", "b4",
  "l0", "l1", "l2",
  "r0", "r1", "r2",
]);

function formatMoney(amount: number): string {
  return `£${Math.round(amount).toLocaleString("en-GB")}`;
}

/** Drop empty/undefined keys, so a picked-but-blank field means "no override" (mirrors StateOverridesEditor). */
function pruneOverride(o: StateOverride): StateOverride {
  const next: Record<string, unknown> = { ...o };
  for (const [key, value] of Object.entries(next)) {
    const empty =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (empty) delete next[key];
  }
  return next as StateOverride;
}

export class ChangeSetBuilder {
  /** Planning clone — never the live workspace. */
  readonly clone: Workspace;
  private readonly bus: CommandBus;
  readonly commands: Command[] = [];
  readonly summary: ChangeSummaryItem[] = [];

  constructor(
    live: Workspace,
    private readonly ids: UlidFactory,
    private readonly activeViewId: Ulid | null,
    stencils?: CommandBusOptions["stencils"],
  ) {
    this.clone = Workspace.fromData(structuredClone(live.toData()));
    this.bus = new CommandBus(this.clone, stencils ? { stencils } : {});
  }

  /** Apply to the clone (validating) and record the command. */
  private push(command: Command, item?: ChangeSummaryItem): void {
    this.bus.dispatch(command); // throws ToolError-worthy messages on invalid input
    this.commands.push(command);
    if (item) this.summary.push(item);
  }

  /** Case-insensitive element lookup by name; errors on unknown or ambiguous. */
  resolveElement(name: string): Element {
    const needle = name.trim().toLowerCase();
    const matches = [...this.clone.elements.values()].filter(
      (e) => e.name.toLowerCase() === needle,
    );
    if (matches.length === 0) {
      throw new ToolError(
        `No element named "${name}". Use query_model to list elements, or create it first.`,
      );
    }
    if (matches.length > 1) {
      throw new ToolError(
        `${matches.length} elements are named "${name}" — qualify which one by renaming or use ids: ${matches
          .map((m) => m.id)
          .join(", ")}.`,
      );
    }
    return matches[0]!;
  }

  resolveState(name: string): NamedState {
    const needle = name.trim().toLowerCase();
    const match = [...this.clone.states.values()].find((s) => s.name.toLowerCase() === needle);
    if (!match) {
      throw new ToolError(
        `No state named "${name}". Existing states: ${[...this.clone.states.values()].map((s) => s.name).join(", ") || "(none)"}.`,
      );
    }
    return match;
  }

  resolveView(name?: string): View {
    if (!name) {
      if (this.activeViewId && this.clone.views.has(this.activeViewId)) {
        return this.clone.view(this.activeViewId);
      }
      throw new ToolError("No view specified and no active view available.");
    }
    const needle = name.trim().toLowerCase();
    const match = [...this.clone.views.values()].find((v) => v.name.toLowerCase() === needle);
    if (!match) {
      throw new ToolError(
        `No view named "${name}". Views: ${[...this.clone.views.values()].map((v) => v.name).join(", ")}.`,
      );
    }
    return match;
  }

  /**
   * Resolve a relationship by endpoint names, disambiguating with the verb
   * phrase (`name`) when several relationships share the same endpoints.
   * Shared by delete_relationships, update_relationships and pin_route.
   */
  resolveRelationship(source: string, target: string, name?: string): Relationship {
    const sourceEl = this.resolveElement(source);
    const targetEl = this.resolveElement(target);
    const candidates = [...this.clone.relationships.values()].filter(
      (r) => r.sourceId === sourceEl.id && r.targetId === targetEl.id,
    );
    const describeCandidates = () =>
      candidates.map((r) => `"${r.name ?? "(unnamed)"}"`).join(", ");

    if (candidates.length === 0) {
      throw new ToolError(`No relationship from "${sourceEl.name}" to "${targetEl.name}".`);
    }
    if (candidates.length === 1) return candidates[0]!;
    if (name) {
      const needle = name.trim().toLowerCase();
      const named = candidates.filter((r) => r.name?.toLowerCase() === needle);
      if (named.length === 0) {
        throw new ToolError(
          `No relationship named "${name}" from "${sourceEl.name}" to "${targetEl.name}". Candidates: ${describeCandidates()}.`,
        );
      }
      if (named.length > 1) {
        throw new ToolError(
          `${named.length} relationships named "${name}" from "${sourceEl.name}" to "${targetEl.name}" — cannot disambiguate further.`,
        );
      }
      return named[0]!;
    }
    throw new ToolError(
      `${candidates.length} relationships from "${sourceEl.name}" to "${targetEl.name}" — pass name to disambiguate. Candidates: ${describeCandidates()}.`,
    );
  }

  createElement(input: {
    name: string;
    kind: ElementKind;
    parent?: string;
    description?: string;
    technology?: string[];
    tags?: string[];
    color?: string;
    stencil?: { pack: string; stencil: string; attributes?: Record<string, unknown> };
  }): Element {
    const parentId = input.parent ? this.resolveElement(input.parent).id : null;
    const element: Element = {
      id: this.ids.next(),
      kind: input.kind,
      name: input.name,
      parentId,
      ...(input.description ? { description: input.description } : {}),
      ...(input.technology?.length ? { technology: input.technology } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(input.color ? { color: input.color } : {}),
      ...(input.stencil ? { stencil: input.stencil as StencilRef } : {}),
    };
    this.push(
      { type: "createElement", element },
      {
        kind: "element",
        description: `Create ${input.kind} "${input.name}"${input.parent ? ` in ${input.parent}` : ""}`,
      },
    );
    return element;
  }

  updateElement(name: string, changes: Partial<Element>): void {
    const el = this.resolveElement(name);
    if (changes.parentId !== undefined && typeof changes.parentId === "string") {
      // callers pass parent by name via tools.ts; already resolved there
    }
    this.push(
      { type: "updateElement", id: el.id, changes: changes as never },
      {
        kind: "update",
        description: `Update "${el.name}": ${Object.keys(changes).join(", ")}`,
      },
    );
  }

  createRelationship(input: {
    source: string;
    target: string;
    name?: string;
    technology?: string[];
    tags?: string[];
    color?: string;
  }): Relationship {
    const source = this.resolveElement(input.source);
    const target = this.resolveElement(input.target);
    const relationship: Relationship = {
      id: this.ids.next(),
      sourceId: source.id,
      targetId: target.id,
      ...(input.name ? { name: input.name } : {}),
      ...(input.technology?.length ? { technology: input.technology } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(input.color ? { color: input.color } : {}),
    };
    this.push(
      { type: "createRelationship", relationship },
      {
        kind: "relationship",
        description: `Connect ${source.name} → ${target.name}${input.name ? ` (${input.name})` : ""}`,
      },
    );
    return relationship;
  }

  /**
   * Update relationships resolved by endpoint names (verb-phrase `name`
   * disambiguates, same as delete_relationships). `new_name` renames the
   * verb phrase; every other field is a straight change, `null` clearing it.
   */
  updateRelationship(input: {
    source: string;
    target: string;
    name?: string;
    new_name?: string | null;
    description?: string | null;
    technology?: string[] | null;
    tags?: string[] | null;
    direction?: RelationshipDirection | null;
    color?: string | null;
  }): void {
    const rel = this.resolveRelationship(input.source, input.target, input.name);
    const sourceEl = this.clone.element(rel.sourceId);
    const targetEl = this.clone.element(rel.targetId);
    const changes: Record<string, unknown> = {};
    if (input.new_name !== undefined) changes["name"] = input.new_name;
    if (input.description !== undefined) changes["description"] = input.description;
    if (input.technology !== undefined) changes["technology"] = input.technology;
    if (input.tags !== undefined) changes["tags"] = input.tags;
    if (input.direction !== undefined) changes["direction"] = input.direction;
    if (input.color !== undefined) changes["color"] = input.color;
    this.push(
      { type: "updateRelationship", id: rel.id, changes: changes as never },
      {
        kind: "relationship",
        description: `Update relationship ${sourceEl.name} → ${targetEl.name}: ${Object.keys(changes).join(", ") || "(no changes)"}`,
      },
    );
  }

  createView(input: { name: string; kind: ViewKind; scope?: string }): View {
    const scopeId = input.scope ? this.resolveElement(input.scope).id : null;
    const view: View = {
      id: this.ids.next(),
      kind: input.kind,
      name: input.name,
      scopeId,
      placements: [],
    };
    this.push(
      { type: "createView", view },
      { kind: "view", description: `Create ${input.kind} view "${input.name}"` },
    );
    return view;
  }

  /**
   * Place elements onto a view. Each entry is either a bare name (auto-laid
   * out in a grid) or `{name, x?, y?, width?, height?}` for explicit
   * geometry — omitted x/y still fall back to the grid position.
   */
  placeOnView(
    elements: Array<string | { name: string; x?: number; y?: number; width?: number; height?: number }>,
    viewName?: string,
  ): View {
    const view = this.resolveView(viewName);
    let index = view.placements.length;
    for (const entry of elements) {
      const spec = typeof entry === "string" ? { name: entry } : entry;
      const el = this.resolveElement(spec.name);
      if (view.placements.some((p) => p.elementId === el.id)) continue; // already there — not an error
      const placement: Placement = {
        elementId: el.id,
        x: spec.x ?? (index % 3) * 13,
        y: spec.y ?? Math.floor(index / 3) * 8,
        ...(spec.width !== undefined ? { width: spec.width } : {}),
        ...(spec.height !== undefined ? { height: spec.height } : {}),
      };
      this.push(
        { type: "placeOnView", viewId: view.id, placement },
        { kind: "placement", description: `Place "${el.name}" on "${view.name}"` },
      );
      index++;
    }
    return view;
  }

  /** Reposition/resize an element already placed on a view. */
  movePlacement(input: {
    element: string;
    view?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }): View {
    const view = this.resolveView(input.view);
    const el = this.resolveElement(input.element);
    const changes: Partial<Omit<Placement, "elementId">> = {};
    if (input.x !== undefined) changes.x = input.x;
    if (input.y !== undefined) changes.y = input.y;
    if (input.width !== undefined) changes.width = input.width;
    if (input.height !== undefined) changes.height = input.height;
    this.push(
      { type: "updatePlacement", viewId: view.id, elementId: el.id, changes },
      { kind: "placement", description: `Move "${el.name}" on "${view.name}"` },
    );
    return view;
  }

  /** All descendants of `id` (recursive), in preorder — a node always precedes its own descendants. */
  private descendantsOf(id: Ulid): Element[] {
    const out: Element[] = [];
    const walk = (parentId: Ulid): void => {
      for (const child of this.clone.children(parentId)) {
        out.push(child);
        walk(child.id);
      }
    };
    walk(id);
    return out;
  }

  /**
   * Queue deletion of one or more elements, cascading to descendants (the
   * command bus itself refuses to delete a container that still has
   * children, so we delete the subtree bottom-up), relationships touching
   * any of them, and view placements. One summary item per requested
   * element, with cascade counts computed from the clone before dispatch.
   */
  deleteElements(names: string[]): void {
    const targets = names.map((name) => this.resolveElement(name));
    for (const el of targets) {
      if (!this.clone.elements.has(el.id)) continue; // already removed by an earlier cascade in this call
      const descendants = this.descendantsOf(el.id);
      const relIds = new Set<Ulid>();
      for (const node of [el, ...descendants]) {
        for (const rel of this.clone.relationshipsOf(node.id)) relIds.add(rel.id);
      }
      // Delete leaves first (reverse preorder is a valid bottom-up order for a tree).
      for (const child of [...descendants].reverse()) {
        this.push({ type: "deleteElement", id: child.id });
      }
      const parts: string[] = [];
      if (descendants.length) {
        parts.push(`+${descendants.length} child${descendants.length === 1 ? "" : "ren"}`);
      }
      if (relIds.size) {
        parts.push(`${relIds.size} relationship${relIds.size === 1 ? "" : "s"}`);
      }
      this.push(
        { type: "deleteElement", id: el.id },
        {
          kind: "element",
          description: `Delete ${el.kind} "${el.name}"${parts.length ? ` (${parts.join(", ")})` : ""}`,
        },
      );
    }
  }

  /**
   * Queue deletion of relationships identified by endpoint names. When
   * several relationships share the same endpoints, `name` (the verb
   * phrase) disambiguates; still-ambiguous cases error with candidates
   * listed rather than guessing.
   */
  deleteRelationships(inputs: Array<{ source: string; target: string; name?: string }>): void {
    for (const input of inputs) {
      const rel = this.resolveRelationship(input.source, input.target, input.name);
      const sourceEl = this.clone.element(rel.sourceId);
      const targetEl = this.clone.element(rel.targetId);
      this.push(
        { type: "deleteRelationship", id: rel.id },
        {
          kind: "relationship",
          description: `Delete relationship ${sourceEl.name} → ${targetEl.name}${rel.name ? ` (${rel.name})` : ""}`,
        },
      );
    }
  }

  /** Queue removal of elements' placements from a view; the elements stay in the model. */
  removeFromView(elementNames: string[], viewName?: string): View {
    const view = this.resolveView(viewName);
    for (const name of elementNames) {
      const el = this.resolveElement(name);
      if (!view.placements.some((p) => p.elementId === el.id)) continue; // not there — not an error
      this.push(
        { type: "removeFromView", viewId: view.id, elementId: el.id },
        { kind: "placement", description: `Remove "${el.name}" from "${view.name}"` },
      );
    }
    return view;
  }

  /** Queue deletion of an entire view; elements and relationships shown on it are untouched. */
  deleteView(name: string): View {
    const view = this.resolveView(name);
    this.push(
      { type: "deleteView", id: view.id },
      { kind: "view", description: `Delete view "${view.name}"` },
    );
    return view;
  }

  setTemporal(input: {
    element: string;
    validFrom?: string;
    validTo?: string;
    states?: string[];
  }): void {
    const el = this.resolveElement(input.element);
    const stateIds = input.states?.map((s) => this.resolveState(s).id);
    const temporal = {
      ...(el.temporal ?? {}),
      ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
      ...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
      ...(stateIds ? { states: stateIds } : {}),
    };
    this.push(
      { type: "updateElement", id: el.id, changes: { temporal } },
      { kind: "state", description: `Set temporal validity on "${el.name}"` },
    );
  }

  /**
   * Merge or clear a per-state attribute override on an element, mirroring
   * the Inspector's StateOverridesEditor: the whole `stateOverrides` map is
   * replaced (or dropped to `null` once no state has an override left).
   */
  setStateOverride(input: {
    element: string;
    state: string;
    overrides?: Partial<StateOverride>;
    clear?: boolean;
  }): void {
    const el = this.resolveElement(input.element);
    const state = this.resolveState(input.state);
    const all = { ...(el.stateOverrides ?? {}) };
    if (input.clear) {
      delete all[state.id];
    } else {
      const merged = pruneOverride({ ...(all[state.id] ?? {}), ...(input.overrides ?? {}) });
      if (Object.keys(merged).length) all[state.id] = merged;
      else delete all[state.id];
    }
    this.push(
      {
        type: "updateElement",
        id: el.id,
        changes: { stateOverrides: (Object.keys(all).length ? all : null) as never },
      },
      {
        kind: "state",
        description: input.clear
          ? `Clear "${state.name}" override on "${el.name}"`
          : `Set "${state.name}" override on "${el.name}"`,
      },
    );
  }

  /**
   * Pin (or clear) the connection ports a relationship's line is routed
   * through on one view. Ports are t0–4 (top), b0–4 (bottom), l0–2 (left),
   * r0–2 (right) — see apps/web/src/ports.ts.
   */
  pinRoute(input: {
    source: string;
    target: string;
    name?: string;
    view?: string;
    source_port?: string;
    target_port?: string;
    clear?: boolean;
  }): View {
    const rel = this.resolveRelationship(input.source, input.target, input.name);
    const view = this.resolveView(input.view);
    const anchors = { ...(view.edgeAnchors ?? {}) };
    if (input.clear) {
      delete anchors[rel.id];
    } else {
      if (!input.source_port || !input.target_port) {
        throw new ToolError("source_port and target_port are required unless clear is true.");
      }
      if (!VALID_PORTS.has(input.source_port) || !VALID_PORTS.has(input.target_port)) {
        throw new ToolError(
          `Invalid port — valid ports are t0-4, b0-4, l0-2, r0-2. Got source_port="${input.source_port}", target_port="${input.target_port}".`,
        );
      }
      anchors[rel.id] = { source: input.source_port, target: input.target_port };
    }
    this.push(
      { type: "updateView", id: view.id, changes: { edgeAnchors: anchors } },
      {
        kind: "view",
        description: input.clear
          ? `Clear route pin on "${view.name}"`
          : `Pin route on "${view.name}" (${input.source_port} → ${input.target_port})`,
      },
    );
    return view;
  }

  /** Replace an element's cost entries; returns how many were set (0 = cleared). */
  setCosts(input: {
    element: string;
    costs: Array<Omit<CostEntry, "id" | "states"> & { states?: string[] }>;
  }): number {
    const el = this.resolveElement(input.element);
    const costs: CostEntry[] = input.costs.map((c) => ({
      ...c,
      id: this.ids.next(),
      ...(c.states?.length ? { states: c.states.map((s) => this.resolveState(s).id) } : {}),
    }));
    this.push(
      { type: "updateElement", id: el.id, changes: { costs: costs.length ? costs : null } as never },
      {
        kind: "update",
        description: costs.length
          ? `Set ${costs.length} cost entr${costs.length === 1 ? "y" : "ies"} on "${el.name}"`
          : `Clear costs on "${el.name}"`,
      },
    );
    return costs.length;
  }

  /**
   * Read-only TCO report: estate-wide (or one element's subtree) run-rate
   * and N-year cost, optionally diffed between two named states. Runs
   * entirely against the clone — queues nothing.
   */
  getTco(input: { element?: string; years?: number; compare_states?: [string, string] }): string {
    const years = input.years ?? 5;
    const ctxFor = (stateName: string): TemporalContext => ({
      type: "state",
      stateId: this.resolveState(stateName).id,
    });

    if (input.compare_states) {
      const [nameA, nameB] = input.compare_states;
      const ctxA = ctxFor(nameA);
      const ctxB = ctxFor(nameB);
      if (input.element) {
        const el = this.resolveElement(input.element);
        const a = elementAnnual(this.clone, el.id, ctxA);
        const b = elementAnnual(this.clone, el.id, ctxB);
        const tcoA = a.rolledUp * years;
        const tcoB = b.rolledUp * years;
        return [
          `TCO for "${el.name}" (subtree), ${nameA} vs ${nameB}, ${years}y:`,
          `  ${nameA}: ${formatMoney(a.rolledUp)}/yr, ${formatMoney(tcoA)} total`,
          `  ${nameB}: ${formatMoney(b.rolledUp)}/yr, ${formatMoney(tcoB)} total`,
          `  Delta: ${formatMoney(b.rolledUp - a.rolledUp)}/yr, ${formatMoney(tcoB - tcoA)} total`,
        ].join("\n");
      }
      const delta = tcoDiff(this.clone, ctxA, ctxB, years);
      return [
        `Estate TCO, ${nameA} vs ${nameB}, ${years}y:`,
        `  ${nameA}: ${formatMoney(delta.annualA)}/yr, ${formatMoney(delta.tcoA)} total`,
        `  ${nameB}: ${formatMoney(delta.annualB)}/yr, ${formatMoney(delta.tcoB)} total`,
        `  Delta: ${formatMoney(delta.annualDelta)}/yr, ${formatMoney(delta.tcoDelta)} total`,
      ].join("\n");
    }

    const ctx: TemporalContext = { type: "all" };
    if (input.element) {
      const el = this.resolveElement(input.element);
      const { own, rolledUp } = elementAnnual(this.clone, el.id, ctx);
      return [
        `TCO for "${el.name}" (subtree), ${years}y:`,
        `  Own: ${formatMoney(own)}/yr`,
        `  Rolled up: ${formatMoney(rolledUp)}/yr, ${formatMoney(rolledUp * years)} total`,
      ].join("\n");
    }

    const report = estateTco(this.clone, ctx, years);
    const rows = report.rows
      .slice(0, 25)
      .map((r: TcoRow) => `  ${r.name} [${r.kind}]: ${formatMoney(r.rolledUpAnnual)}/yr, ${formatMoney(r.tco)} total`);
    return [
      `Estate TCO, ${years}y (${report.rows.length} cost-bearing element${report.rows.length === 1 ? "" : "s"}):`,
      ...rows,
      report.rows.length > 25 ? `  … and ${report.rows.length - 25} more` : null,
      `Total: ${formatMoney(report.totalAnnual)}/yr, ${formatMoney(report.totalTco)} over ${years}y`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** The accumulated change set as one atomic, single-undo batch. */
  toBatch(label: string): Command | null {
    if (this.commands.length === 0) return null;
    return { type: "batch", label, commands: this.commands };
  }
}
