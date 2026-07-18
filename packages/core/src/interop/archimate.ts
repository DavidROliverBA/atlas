/**
 * Best-effort ArchiMate Open Exchange import (§3.9). Maps the Business and
 * Application layers onto Atlas kinds; every unmapped concept becomes a
 * warning, never a failure. Mapping table: /docs/interop.md.
 */

import { XMLParser } from "fast-xml-parser";
import type { UlidFactory } from "../ids.js";
import type { Element, Relationship } from "../metamodel/types.js";
import { Workspace } from "../model/workspace.js";
import { CommandBus } from "../commands/bus.js";

const KIND_MAP: Record<string, Element["kind"]> = {
  BusinessActor: "person",
  BusinessRole: "person",
  ApplicationComponent: "system",
  ApplicationCollaboration: "system",
  ApplicationService: "system",
  Node: "system",
  Device: "system",
  SystemSoftware: "system",
  Artifact: "system",
  Grouping: "group",
};

export interface ArchimateImportResult {
  workspace: Workspace;
  warnings: string[];
}

interface XmlElement {
  "@_identifier": string;
  "@_xsi:type": string;
  name?: { "#text"?: string } | string;
  documentation?: { "#text"?: string } | string;
}

interface XmlRelationship {
  "@_identifier": string;
  "@_xsi:type": string;
  "@_source": string;
  "@_target": string;
  name?: { "#text"?: string } | string;
}

const text = (value: XmlElement["name"]): string | undefined =>
  typeof value === "string" ? value : value?.["#text"];

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

export function importArchimate(xml: string, ids: UlidFactory): ArchimateImportResult {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: false });
  const doc = parser.parse(xml) as {
    model?: {
      elements?: { element?: XmlElement | XmlElement[] };
      relationships?: { relationship?: XmlRelationship | XmlRelationship[] };
      name?: XmlElement["name"];
    };
  };
  const model = doc.model;
  if (!model) throw new Error("Not an ArchiMate Open Exchange file (no <model> root)");

  const ws = new Workspace({ name: text(model.name) ?? "Imported ArchiMate model" });
  const bus = new CommandBus(ws);
  const warnings: string[] = [];
  const idMap = new Map<string, string>();

  for (const el of asArray(model.elements?.element)) {
    const xsiType = el["@_xsi:type"];
    const kind = KIND_MAP[xsiType];
    const name = text(el.name) ?? el["@_identifier"];
    if (!kind) {
      warnings.push(`Skipped ${xsiType} "${name}" — no Atlas mapping (see docs/interop.md)`);
      continue;
    }
    const element: Element = {
      id: ids.next(),
      kind,
      name,
      parentId: null,
      tags: [`archimate:${xsiType.toLowerCase()}`],
      ...(text(el.documentation) ? { description: text(el.documentation) } : {}),
    };
    try {
      bus.dispatch({ type: "createElement", element });
      idMap.set(el["@_identifier"], element.id);
    } catch (err) {
      warnings.push(`Skipped ${xsiType} "${name}": ${(err as Error).message}`);
    }
  }

  for (const rel of asArray(model.relationships?.relationship)) {
    const sourceId = idMap.get(rel["@_source"]);
    const targetId = idMap.get(rel["@_target"]);
    const xsiType = rel["@_xsi:type"];
    if (!sourceId || !targetId) {
      warnings.push(`Skipped ${xsiType} relationship — endpoint not imported`);
      continue;
    }
    const relationship: Relationship = {
      id: ids.next(),
      sourceId,
      targetId,
      name: text(rel.name) ?? xsiType.toLowerCase(),
      tags: [`archimate:${xsiType.toLowerCase()}`],
    };
    try {
      bus.dispatch({ type: "createRelationship", relationship });
    } catch (err) {
      warnings.push(`Skipped ${xsiType} relationship: ${(err as Error).message}`);
    }
  }

  const topLevel = ws.children(null).filter((e) => e.kind !== "group");
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
