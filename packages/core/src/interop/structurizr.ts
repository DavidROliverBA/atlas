/**
 * Best-effort Structurizr JSON import (§3.9). Maps the Structurizr workspace
 * model (people, software systems, containers, components, relationships)
 * onto Atlas elements and relationships, plus one auto-laid-out landscape
 * view. Mapping notes: /docs/interop.md.
 */

import type { UlidFactory } from "../ids.js";
import type { Element, Relationship } from "../metamodel/types.js";
import { Workspace } from "../model/workspace.js";
import { CommandBus } from "../commands/bus.js";

interface StructurizrElement {
  id: string;
  name: string;
  description?: string;
  technology?: string;
  tags?: string;
  relationships?: StructurizrRelationship[];
  containers?: StructurizrElement[];
  components?: StructurizrElement[];
}

interface StructurizrRelationship {
  sourceId: string;
  destinationId: string;
  description?: string;
  technology?: string;
}

export interface StructurizrWorkspace {
  name?: string;
  description?: string;
  model?: {
    people?: StructurizrElement[];
    softwareSystems?: StructurizrElement[];
  };
}

function tagsOf(raw: string | undefined): string[] | undefined {
  const tags = raw
    ?.split(",")
    .map((t) => t.trim())
    .filter((t) => t && !["Element", "Person", "Software System", "Container", "Component"].includes(t));
  return tags?.length ? tags : undefined;
}

export interface StructurizrImportResult {
  workspace: Workspace;
  warnings: string[];
}

export function importStructurizr(
  input: StructurizrWorkspace,
  ids: UlidFactory,
): StructurizrImportResult {
  const ws = new Workspace({
    name: input.name ?? "Imported workspace",
    ...(input.description ? { description: input.description } : {}),
  });
  const bus = new CommandBus(ws);
  const warnings: string[] = [];
  const idMap = new Map<string, string>(); // structurizr id → ulid
  const pendingRels: StructurizrRelationship[] = [];

  const addElement = (
    src: StructurizrElement,
    kind: Element["kind"],
    parentId: string | null,
  ): void => {
    const element: Element = {
      id: ids.next(),
      kind,
      name: src.name,
      parentId,
      ...(src.description ? { description: src.description } : {}),
      ...(src.technology ? { technology: src.technology.split(",").map((t) => t.trim()) } : {}),
      ...(tagsOf(src.tags) ? { tags: tagsOf(src.tags) } : {}),
    };
    try {
      bus.dispatch({ type: "createElement", element });
      idMap.set(src.id, element.id);
    } catch (err) {
      warnings.push(`Skipped ${kind} "${src.name}": ${(err as Error).message}`);
      return;
    }
    pendingRels.push(...(src.relationships ?? []));
    if (kind === "system") {
      for (const container of src.containers ?? []) addElement(container, "container", element.id);
    }
    if (kind === "container") {
      for (const component of src.components ?? []) addElement(component, "component", element.id);
    }
  };

  for (const person of input.model?.people ?? []) addElement(person, "person", null);
  for (const system of input.model?.softwareSystems ?? []) addElement(system, "system", null);

  for (const rel of pendingRels) {
    const sourceId = idMap.get(rel.sourceId);
    const targetId = idMap.get(rel.destinationId);
    if (!sourceId || !targetId) {
      warnings.push(`Skipped relationship ${rel.sourceId} → ${rel.destinationId}: endpoint not imported`);
      continue;
    }
    const relationship: Relationship = {
      id: ids.next(),
      sourceId,
      targetId,
      ...(rel.description ? { name: rel.description } : {}),
      ...(rel.technology ? { technology: rel.technology.split(",").map((t) => t.trim()) } : {}),
    };
    try {
      bus.dispatch({ type: "createRelationship", relationship });
    } catch (err) {
      warnings.push(`Skipped relationship: ${(err as Error).message}`);
    }
  }

  // One auto-laid-out landscape of the top level (Structurizr view geometry is not mapped).
  const topLevel = ws.children(null);
  bus.dispatch({
    type: "createView",
    view: {
      id: ids.next(),
      kind: "landscape",
      name: "Landscape",
      scopeId: null,
      placements: topLevel.map((el, i) => ({
        elementId: el.id,
        x: (i % 4) * 13,
        y: Math.floor(i / 4) * 8,
      })),
    },
  });

  return { workspace: ws, warnings };
}
