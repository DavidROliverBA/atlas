/**
 * Compact model summary sent as context (brief §3.7): ids, names, kinds and
 * key relationships — never the full serialisation. Detail retrieval happens
 * through the query_model tool.
 */

import type { Workspace } from "@atlas/core";

export function buildModelSummary(ws: Workspace): string {
  const lines: string[] = [`Workspace: ${ws.meta.name}`];

  lines.push(`\nElements (${ws.elements.size}):`);
  const describe = (parentId: string | null, depth: number): void => {
    for (const el of [...ws.elements.values()]
      .filter((e) => e.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const bits = [el.kind, el.status, el.tags?.length ? `tags:${el.tags.join("|")}` : null]
        .filter(Boolean)
        .join(", ");
      lines.push(`${"  ".repeat(depth + 1)}- ${el.name} (${bits})`);
      describe(el.id, depth + 1);
    }
  };
  describe(null, 0);

  lines.push(`\nRelationships (${ws.relationships.size}):`);
  for (const r of ws.relationships.values()) {
    const s = ws.elements.get(r.sourceId)?.name ?? r.sourceId;
    const t = ws.elements.get(r.targetId)?.name ?? r.targetId;
    lines.push(`  - ${s} → ${t}${r.name ? ` (${r.name})` : ""}`);
  }

  lines.push(`\nViews (${ws.views.size}):`);
  for (const v of ws.views.values()) {
    lines.push(`  - "${v.name}" (${v.kind}, ${v.placements.length} elements placed)`);
  }

  if (ws.states.size) {
    lines.push(`\nNamed states: ${[...ws.states.values()].map((s) => `"${s.name}"${s.date ? ` @${s.date}` : ""}`).join(", ")}`);
  }
  return lines.join("\n");
}

/** Full detail for one element, for query_model. */
export function describeElement(ws: Workspace, name: string): string | null {
  const el = [...ws.elements.values()].find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!el) return null;
  const rels = ws.relationshipsOf(el.id).map((r) => {
    const out = r.sourceId === el.id;
    const other = ws.elements.get(out ? r.targetId : r.sourceId)?.name;
    return `  ${out ? "→" : "←"} ${other}${r.name ? ` (${r.name})` : ""}`;
  });
  return [
    `${el.name} [${el.kind}] id=${el.id}`,
    el.description && `description: ${el.description}`,
    el.technology?.length && `technology: ${el.technology.join(", ")}`,
    el.status && `status: ${el.status}`,
    el.tags?.length && `tags: ${el.tags.join(", ")}`,
    el.temporal && `temporal: ${JSON.stringify(el.temporal)}`,
    el.costs?.length &&
      `costs: ${el.costs
        .map((c) => `${c.label} ${c.currency ?? "GBP"} ${c.amount} ${c.kind === "recurring" ? `per ${c.period ?? "annual"} period` : `one-off over ${c.amortiseYears ?? 3}y`} (${c.category}/${c.classification})`)
        .join("; ")}`,
    `appears in: ${ws.viewsContaining(el.id).map((v) => `"${v.name}"`).join(", ") || "(no views)"}`,
    rels.length ? `relationships:\n${rels.join("\n")}` : "relationships: none",
  ]
    .filter(Boolean)
    .join("\n");
}
