/**
 * Serialisable commands: the only way to mutate a workspace. The same
 * command shapes are dispatched by the UI, the AI tools, the CLI and (later)
 * realtime sync, so undo/redo, validation and persistence behave identically
 * everywhere (Architecture Principle 2).
 */

import type { Ulid } from "../ids.js";
import type {
  Element,
  NamedState,
  Placement,
  Relationship,
  View,
} from "../metamodel/types.js";

export type Command =
  | { type: "createElement"; element: Element }
  | { type: "updateElement"; id: Ulid; changes: Partial<Omit<Element, "id" | "kind">> }
  | { type: "deleteElement"; id: Ulid }
  | { type: "createRelationship"; relationship: Relationship }
  | { type: "updateRelationship"; id: Ulid; changes: Partial<Omit<Relationship, "id">> }
  | { type: "deleteRelationship"; id: Ulid }
  | { type: "createView"; view: View }
  | { type: "updateView"; id: Ulid; changes: Partial<Omit<View, "id" | "placements">> }
  | { type: "deleteView"; id: Ulid }
  | { type: "placeOnView"; viewId: Ulid; placement: Placement }
  | { type: "updatePlacement"; viewId: Ulid; elementId: Ulid; changes: Partial<Omit<Placement, "elementId">> }
  | { type: "removeFromView"; viewId: Ulid; elementId: Ulid }
  | { type: "createState"; state: NamedState }
  | { type: "updateState"; id: Ulid; changes: Partial<Omit<NamedState, "id">> }
  | { type: "deleteState"; id: Ulid }
  | { type: "batch"; label?: string; commands: Command[] };

export type CommandType = Command["type"];
