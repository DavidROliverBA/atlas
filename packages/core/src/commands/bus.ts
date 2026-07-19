/**
 * The command bus: applies commands to a workspace, computes exact inverse
 * commands, and maintains undo/redo stacks. Batches are atomic (all-or-
 * nothing) and undo as a single step.
 */

import type { Ulid } from "../ids.js";
import type { CostEntry, Element, NamedState, Placement, Relationship, Temporal, View } from "../metamodel/types.js";
import { Workspace } from "../model/workspace.js";
import {
  ModelRuleError,
  assertLegalContainment,
  assertLegalEndpoints,
  assertNoCycle,
  assertPlaceableOnView,
} from "../metamodel/rules.js";
import type { Command } from "./commands.js";

export interface HistoryEntry {
  do: Command;
  undo: Command;
  label?: string;
}

export type BusEvent =
  | { type: "applied"; command: Command }
  | { type: "undone"; command: Command }
  | { type: "redone"; command: Command };

type Listener = (event: BusEvent) => void;

/**
 * Apply `changes` to `target`, treating explicit `null` as "remove this
 * optional property" (commands must stay JSON-serialisable, so `undefined`
 * cannot travel over the wire). Returns the inverse changes.
 */
/**
 * Keys where `null` is a real value (explicitly "top level"), not "clear this
 * optional field". Deleting these instead of assigning null makes the object
 * invisible to strict `=== null` scans like `Workspace.children(null)`.
 */
const NULL_VALUED_KEYS = new Set(["parentId", "scopeId"]);

function applyChanges<T extends object>(target: T, changes: Partial<T>): Partial<T> {
  const inverse: Record<string, unknown> = {};
  const record = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    inverse[key] = key in record ? record[key] : null;
    if (value === null && !NULL_VALUED_KEYS.has(key)) {
      delete record[key];
    } else {
      record[key] = value;
    }
  }
  return inverse as Partial<T>;
}

function checkTemporal(ws: Workspace, temporal: Temporal | null | undefined): void {
  if (!temporal) return;
  for (const stateId of temporal.states ?? []) {
    if (!ws.states.has(stateId)) {
      throw new ModelRuleError(`Unknown state referenced: ${stateId}`, "unknown-endpoint");
    }
  }
  if (temporal.validFrom && temporal.validTo && temporal.validFrom > temporal.validTo) {
    throw new Error(`validFrom (${temporal.validFrom}) is after validTo (${temporal.validTo})`);
  }
}

function checkCosts(ws: Workspace, costs: CostEntry[] | null | undefined): void {
  if (!costs) return;
  const seen = new Set<Ulid>();
  for (const cost of costs) {
    if (seen.has(cost.id)) throw new Error(`Duplicate cost entry id: ${cost.id}`);
    seen.add(cost.id);
    for (const stateId of cost.states ?? []) {
      if (!ws.states.has(stateId)) {
        throw new Error(`Unknown state referenced by cost "${cost.label}": ${stateId}`);
      }
    }
    if (!cost.label.trim()) throw new Error("Cost entries need a label");
    if (cost.amount <= 0) throw new Error(`Cost "${cost.label}" amount must be greater than zero`);
    if (cost.validFrom && cost.validTo && cost.validFrom > cost.validTo) {
      throw new Error(`Cost "${cost.label}" validFrom (${cost.validFrom}) is after validTo (${cost.validTo})`);
    }
  }
}

export interface CommandBusOptions {
  /** When provided, stencil refs and their attributes are validated at command time. */
  stencils?: { validateRef(ref: NonNullable<Element["stencil"]>): string[] };
}

export class CommandBus {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<Listener>();

  constructor(
    readonly workspace: Workspace,
    private readonly options: CommandBusOptions = {},
  ) {}

  private checkStencil(stencil: Element["stencil"] | null | undefined): void {
    if (!stencil || !this.options.stencils) return;
    const issues = this.options.stencils.validateRef(stencil);
    if (issues.length) throw new Error(issues.join("; "));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: BusEvent): void {
    for (const l of this.listeners) l(event);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get history(): readonly HistoryEntry[] {
    return this.undoStack;
  }

  /** The entry undo() would apply next (top of the undo stack). */
  get peekUndo(): HistoryEntry | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  /** The entry redo() would apply next (top of the redo stack). */
  get peekRedo(): HistoryEntry | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  /** Validate and apply a command; push its inverse onto the undo stack. */
  dispatch(command: Command): void {
    const undo = this.apply(command);
    this.undoStack.push({ do: command, undo, label: command.type === "batch" ? command.label : undefined });
    this.redoStack = [];
    this.emit({ type: "applied", command });
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.apply(entry.undo);
    this.redoStack.push(entry);
    this.emit({ type: "undone", command: entry.undo });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.apply(entry.do);
    this.undoStack.push(entry);
    this.emit({ type: "redone", command: entry.do });
    return true;
  }

  // ---- application -------------------------------------------------------

  /** Apply a command and return its exact inverse. Throws without mutating on validation failure. */
  private apply(command: Command): Command {
    const ws = this.workspace;
    switch (command.type) {
      case "createElement": {
        const el = command.element;
        if (ws.elements.has(el.id)) throw new Error(`Element already exists: ${el.id}`);
        assertLegalContainment(ws, el.kind, el.parentId);
        checkTemporal(ws, el.temporal);
        checkCosts(ws, el.costs);
        this.checkStencil(el.stencil);
        ws.elements.set(el.id, structuredClone(el));
        return { type: "deleteElement", id: el.id };
      }

      case "updateElement": {
        const el = ws.element(command.id);
        const changes = command.changes as Partial<Element>;
        if (changes.parentId !== undefined) {
          assertNoCycle(ws, el, changes.parentId);
          assertLegalContainment(ws, el.kind, changes.parentId);
          // Descendants keep their relative position, so a legal move for
          // the element is legal for the subtree (scopes below it are
          // defined by the element itself, which does not change kind).
        }
        checkTemporal(ws, changes.temporal);
        checkCosts(ws, changes.costs);
        if (changes.stateOverrides) {
          for (const stateId of Object.keys(changes.stateOverrides)) {
            if (!ws.states.has(stateId)) throw new Error(`Unknown state in overrides: ${stateId}`);
          }
        }
        if (changes.name !== undefined && changes.name !== null && changes.name.trim() === "") {
          throw new Error("Element name cannot be empty");
        }
        if (changes.stencil !== undefined) this.checkStencil(changes.stencil);
        const inverse = applyChanges(el, changes);
        return { type: "updateElement", id: command.id, changes: inverse };
      }

      case "deleteElement": {
        const el = ws.element(command.id);
        if (ws.children(el.id).length > 0) {
          throw new Error(`"${el.name}" still contains elements — delete or move them first.`);
        }
        // Cascade: relationships touching the element, and placements on all views.
        const restore: Command[] = [{ type: "createElement", element: structuredClone(el) }];
        for (const rel of ws.relationshipsOf(el.id)) {
          restore.push(...this.cascadeDeleteRelationship(rel.id));
        }
        for (const view of ws.viewsContaining(el.id)) {
          const placement = view.placements.find((p) => p.elementId === el.id);
          if (placement) {
            view.placements = view.placements.filter((p) => p.elementId !== el.id);
            restore.push({ type: "placeOnView", viewId: view.id, placement });
          }
        }
        ws.elements.delete(el.id);
        return { type: "batch", commands: restore };
      }

      case "createRelationship": {
        const rel = command.relationship;
        if (ws.relationships.has(rel.id)) throw new Error(`Relationship already exists: ${rel.id}`);
        assertLegalEndpoints(ws, rel.sourceId, rel.targetId);
        checkTemporal(ws, rel.temporal);
        ws.relationships.set(rel.id, structuredClone(rel));
        return { type: "deleteRelationship", id: rel.id };
      }

      case "updateRelationship": {
        const rel = ws.relationship(command.id);
        const changes = command.changes as Partial<Relationship>;
        if (changes.sourceId !== undefined || changes.targetId !== undefined) {
          assertLegalEndpoints(
            ws,
            (changes.sourceId ?? rel.sourceId) as Ulid,
            (changes.targetId ?? rel.targetId) as Ulid,
          );
        }
        checkTemporal(ws, changes.temporal);
        const inverse = applyChanges(rel, changes);
        return { type: "updateRelationship", id: command.id, changes: inverse };
      }

      case "deleteRelationship": {
        return { type: "batch", commands: this.cascadeDeleteRelationship(command.id) };
      }

      case "createView": {
        const view = command.view;
        if (ws.views.has(view.id)) throw new Error(`View already exists: ${view.id}`);
        if (view.scopeId !== null && !ws.elements.has(view.scopeId)) {
          throw new Error(`View scope element does not exist: ${view.scopeId}`);
        }
        const seen = new Set<string>();
        for (const p of view.placements) {
          if (!ws.elements.has(p.elementId)) throw new Error(`Placed element does not exist: ${p.elementId}`);
          if (seen.has(p.elementId)) throw new Error(`Element placed twice: ${p.elementId}`);
          seen.add(p.elementId);
          assertPlaceableOnView(view.kind, ws.element(p.elementId).kind);
        }
        ws.views.set(view.id, structuredClone(view));
        return { type: "deleteView", id: view.id };
      }

      case "updateView": {
        const view = ws.view(command.id);
        const changes = command.changes as Partial<View>;
        if (changes.scopeId !== undefined && changes.scopeId !== null && !ws.elements.has(changes.scopeId)) {
          throw new Error(`View scope element does not exist: ${changes.scopeId}`);
        }
        for (const relId of changes.hiddenRelationshipIds ?? []) {
          if (!ws.relationships.has(relId)) throw new Error(`Unknown relationship hidden: ${relId}`);
        }
        for (const relId of Object.keys(changes.edgeAnchors ?? {})) {
          if (!ws.relationships.has(relId)) throw new Error(`Unknown relationship anchored: ${relId}`);
        }
        const inverse = applyChanges(view, changes);
        return { type: "updateView", id: command.id, changes: inverse };
      }

      case "deleteView": {
        const view = ws.view(command.id);
        ws.views.delete(view.id);
        return { type: "createView", view: structuredClone(view) };
      }

      case "placeOnView": {
        const view = ws.view(command.viewId);
        const { placement } = command;
        if (!ws.elements.has(placement.elementId)) {
          throw new Error(`Cannot place unknown element: ${placement.elementId}`);
        }
        if (view.placements.some((p) => p.elementId === placement.elementId)) {
          throw new Error(`Element is already on this view: ${placement.elementId}`);
        }
        assertPlaceableOnView(view.kind, ws.element(placement.elementId).kind);
        view.placements = [...view.placements, structuredClone(placement)];
        return { type: "removeFromView", viewId: view.id, elementId: placement.elementId };
      }

      case "updatePlacement": {
        const view = ws.view(command.viewId);
        const placement = view.placements.find((p) => p.elementId === command.elementId);
        if (!placement) throw new Error(`Element is not on this view: ${command.elementId}`);
        const inverse = applyChanges(placement, command.changes as Partial<Placement>);
        return { type: "updatePlacement", viewId: command.viewId, elementId: command.elementId, changes: inverse };
      }

      case "removeFromView": {
        const view = ws.view(command.viewId);
        const placement = view.placements.find((p) => p.elementId === command.elementId);
        if (!placement) throw new Error(`Element is not on this view: ${command.elementId}`);
        view.placements = view.placements.filter((p) => p.elementId !== command.elementId);
        return { type: "placeOnView", viewId: command.viewId, placement };
      }

      case "createState": {
        const state = command.state;
        if (ws.states.has(state.id)) throw new Error(`State already exists: ${state.id}`);
        ws.states.set(state.id, structuredClone(state));
        return { type: "deleteState", id: state.id };
      }

      case "updateState": {
        const state = ws.state(command.id);
        const inverse = applyChanges(state, command.changes as Partial<NamedState>);
        return { type: "updateState", id: command.id, changes: inverse };
      }

      case "deleteState": {
        const state = ws.state(command.id);
        // Cascade: drop membership and overrides referencing this state.
        const restore: Command[] = [{ type: "createState", state: structuredClone(state) }];
        const scrub = (entity: Element | Relationship, asElement: boolean) => {
          const usesState =
            entity.temporal?.states?.includes(state.id) ||
            (asElement && (entity as Element).stateOverrides?.[state.id] !== undefined);
          if (!usesState) return;
          const changes: Record<string, unknown> = {};
          if (entity.temporal?.states?.includes(state.id)) {
            const states = entity.temporal.states.filter((s) => s !== state.id);
            changes["temporal"] = { ...entity.temporal, ...(states.length ? { states } : {}) };
            if (!states.length) delete (changes["temporal"] as Temporal).states;
          }
          if (asElement && (entity as Element).stateOverrides?.[state.id] !== undefined) {
            const overrides = { ...(entity as Element).stateOverrides };
            delete overrides[state.id];
            changes["stateOverrides"] = Object.keys(overrides).length ? overrides : null;
          }
          if (asElement) {
            restore.push({
              type: "updateElement",
              id: entity.id,
              changes: {
                temporal: entity.temporal ?? null,
                stateOverrides: (entity as Element).stateOverrides ?? null,
              } as never,
            });
            applyChanges(entity, changes as Partial<Element>);
          } else {
            restore.push({
              type: "updateRelationship",
              id: entity.id,
              changes: { temporal: entity.temporal ?? null } as never,
            });
            applyChanges(entity, changes as Partial<Relationship>);
          }
        };
        for (const el of ws.elements.values()) scrub(el, true);
        for (const rel of ws.relationships.values()) scrub(rel, false);
        ws.states.delete(state.id);
        return { type: "batch", commands: restore };
      }

      case "updateWorkspaceMeta": {
        if (command.changes.name !== undefined && command.changes.name !== null && !command.changes.name.trim()) {
          throw new Error("Workspace name cannot be empty");
        }
        const inverse = applyChanges(ws.meta, command.changes as Partial<typeof ws.meta>);
        return { type: "updateWorkspaceMeta", changes: inverse };
      }

      case "batch": {
        const applied: Command[] = [];
        try {
          for (const sub of command.commands) {
            applied.push(this.apply(sub));
          }
        } catch (err) {
          // Roll back what already succeeded, in reverse order.
          for (const inverse of applied.reverse()) this.apply(inverse);
          throw err;
        }
        return { type: "batch", label: command.label, commands: applied.reverse() };
      }
    }
  }

  /** Remove a relationship plus any per-view references (hidden list, edge anchors); return restore commands. */
  private cascadeDeleteRelationship(relId: Ulid): Command[] {
    const ws = this.workspace;
    const rel = ws.relationship(relId);
    const restore: Command[] = [{ type: "createRelationship", relationship: structuredClone(rel) }];
    for (const view of ws.views.values()) {
      if (view.hiddenRelationshipIds?.includes(relId)) {
        restore.push({
          type: "updateView",
          id: view.id,
          changes: { hiddenRelationshipIds: [...view.hiddenRelationshipIds] },
        });
        const remaining = view.hiddenRelationshipIds.filter((id) => id !== relId);
        if (remaining.length) view.hiddenRelationshipIds = remaining;
        else delete view.hiddenRelationshipIds;
      }
      if (view.edgeAnchors?.[relId]) {
        restore.push({
          type: "updateView",
          id: view.id,
          changes: { edgeAnchors: structuredClone(view.edgeAnchors) },
        });
        const anchors = { ...view.edgeAnchors };
        delete anchors[relId];
        if (Object.keys(anchors).length) view.edgeAnchors = anchors;
        else delete view.edgeAnchors;
      }
    }
    ws.relationships.delete(relId);
    return restore;
  }
}
