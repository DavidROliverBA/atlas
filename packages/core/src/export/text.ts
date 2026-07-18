/**
 * Text-format exports (§3.9): Mermaid C4 and PlantUML C4 renderings of a
 * view. Deterministic output (sorted by id) so exports diff cleanly.
 */

import type { Ulid } from "../ids.js";
import type { Element } from "../metamodel/types.js";
import type { Workspace } from "../model/workspace.js";

function sanitizeId(id: Ulid): string {
  return `el_${id}`;
}

interface ViewScope {
  elements: Element[];
  relationships: Array<{ sourceId: Ulid; targetId: Ulid; name?: string; technology?: string[] }>;
}

function scopeOf(ws: Workspace, viewId: Ulid): ViewScope {
  const view = ws.view(viewId);
  const placed = new Set(view.placements.map((p) => p.elementId));
  const elements = [...ws.elements.values()]
    .filter((e) => placed.has(e.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const relationships = [...ws.relationships.values()]
    .filter(
      (r) =>
        placed.has(r.sourceId) &&
        placed.has(r.targetId) &&
        !view.hiddenRelationshipIds?.includes(r.id),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return { elements, relationships };
}

const MERMAID_KIND: Record<Element["kind"], string> = {
  person: "Person",
  system: "System",
  container: "Container",
  component: "Component",
  group: "System_Boundary",
};

/** Mermaid C4 (C4Context-style) text for a view. */
export function toMermaidC4(ws: Workspace, viewId: Ulid): string {
  const view = ws.view(viewId);
  const { elements, relationships } = scopeOf(ws, viewId);
  const lines = ["C4Context", `  title ${view.name}`];
  for (const el of elements) {
    if (el.kind === "group") {
      lines.push(`  System_Boundary(${sanitizeId(el.id)}, "${el.name}") {`, "  }");
      continue;
    }
    const kind = MERMAID_KIND[el.kind];
    const tech = el.technology?.length ? `, "${el.technology.join(", ")}"` : "";
    const kindWithTech = el.kind === "container" || el.kind === "component" ? kind : kind;
    lines.push(
      `  ${kindWithTech}(${sanitizeId(el.id)}, "${el.name}"${
        el.kind === "container" || el.kind === "component" ? tech || ', ""' : ""
      }${el.description ? `, "${el.description}"` : ""})`,
    );
  }
  for (const r of relationships) {
    const label = r.name ?? "uses";
    const tech = r.technology?.length ? `, "${r.technology.join(", ")}"` : "";
    lines.push(`  Rel(${sanitizeId(r.sourceId)}, ${sanitizeId(r.targetId)}, "${label}"${tech})`);
  }
  return lines.join("\n") + "\n";
}

const PLANTUML_KIND: Record<Element["kind"], string> = {
  person: "Person",
  system: "System",
  container: "Container",
  component: "Component",
  group: "Boundary",
};

/** PlantUML C4 (C4-PlantUML) text for a view. */
export function toPlantUmlC4(ws: Workspace, viewId: Ulid): string {
  const view = ws.view(viewId);
  const { elements, relationships } = scopeOf(ws, viewId);
  const include =
    view.kind === "component"
      ? "C4_Component.puml"
      : view.kind === "container"
        ? "C4_Container.puml"
        : "C4_Context.puml";
  const lines = [
    "@startuml",
    `!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/${include}`,
    `title ${view.name}`,
    "",
  ];
  for (const el of elements) {
    if (el.kind === "group") continue;
    const kind = PLANTUML_KIND[el.kind];
    const args = [
      sanitizeId(el.id),
      `"${el.name}"`,
      ...(el.kind === "container" || el.kind === "component"
        ? [`"${el.technology?.join(", ") ?? ""}"`]
        : []),
      ...(el.description ? [`"${el.description}"`] : []),
    ];
    lines.push(`${kind}(${args.join(", ")})`);
  }
  lines.push("");
  for (const r of relationships) {
    const args = [
      sanitizeId(r.sourceId),
      sanitizeId(r.targetId),
      `"${r.name ?? "uses"}"`,
      ...(r.technology?.length ? [`"${r.technology.join(", ")}"`] : []),
    ];
    lines.push(`Rel(${args.join(", ")})`);
  }
  lines.push("@enduml");
  return lines.join("\n") + "\n";
}
