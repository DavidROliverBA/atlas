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
  type Command,
  type Element,
  type ElementKind,
  type NamedState,
  type Relationship,
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
  ) {
    this.clone = Workspace.fromData(structuredClone(live.toData()));
    this.bus = new CommandBus(this.clone);
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

  createElement(input: {
    name: string;
    kind: ElementKind;
    parent?: string;
    description?: string;
    technology?: string[];
    tags?: string[];
    color?: string;
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
    };
    this.push(
      { type: "createElement", element },
      { kind: "element", description: `Create ${input.kind} "${input.name}"${input.parent ? ` in ${input.parent}` : ""}` },
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

  placeOnView(elementNames: string[], viewName?: string): View {
    const view = this.resolveView(viewName);
    let index = view.placements.length;
    for (const name of elementNames) {
      const el = this.resolveElement(name);
      if (view.placements.some((p) => p.elementId === el.id)) continue; // already there — not an error
      this.push(
        {
          type: "placeOnView",
          viewId: view.id,
          placement: { elementId: el.id, x: (index % 3) * 13, y: Math.floor(index / 3) * 8 },
        },
        { kind: "placement", description: `Place "${el.name}" on "${view.name}"` },
      );
      index++;
    }
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

  /** The accumulated change set as one atomic, single-undo batch. */
  toBatch(label: string): Command | null {
    if (this.commands.length === 0) return null;
    return { type: "batch", label, commands: this.commands };
  }
}
