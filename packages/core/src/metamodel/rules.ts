/**
 * Metamodel rules: legal containment and relationship endpoints, enforced in
 * core so every mutation path (UI, AI, CLI, sync) gets the same errors
 * (Architecture Principle 3).
 */

import type { Ulid } from "../ids.js";
import type { Element, ElementKind } from "./types.js";
import type { Workspace } from "../model/workspace.js";

export class ModelRuleError extends Error {
  constructor(
    message: string,
    readonly code:
      | "illegal-containment"
      | "containment-cycle"
      | "unknown-parent"
      | "unknown-endpoint"
      | "illegal-endpoint"
      | "kind-immutable",
  ) {
    super(message);
    this.name = "ModelRuleError";
  }
}

/**
 * Which resolved scope kinds may contain each element kind. `null` in the
 * list means "top level". Groups are transparent (see Workspace.resolveScope)
 * and may themselves sit anywhere.
 */
const LEGAL_SCOPES: Record<ElementKind, ReadonlyArray<ElementKind | null>> = {
  person: [null],
  system: [null],
  container: ["system"],
  component: ["container"],
  group: [null, "system", "container"],
};

function label(kind: ElementKind): string {
  return { person: "Person", system: "Software System", container: "Container", component: "Component", group: "Group" }[kind];
}

/** Throws ModelRuleError if placing `kind` under `parentId` is illegal. */
export function assertLegalContainment(
  ws: Workspace,
  kind: ElementKind,
  parentId: Ulid | null,
): void {
  if (parentId !== null && !ws.elements.has(parentId)) {
    throw new ModelRuleError(`Parent element does not exist: ${parentId}`, "unknown-parent");
  }
  const scope = ws.resolveScope(parentId);
  const legal = LEGAL_SCOPES[kind];
  if (!legal.includes(scope === null ? null : scope.kind)) {
    const where = scope === null ? "at the top level" : `inside a ${label(scope.kind)}`;
    throw new ModelRuleError(
      `A ${label(kind)} cannot live ${where}. Legal parents: ${legal
        .map((k) => (k === null ? "top level" : label(k)))
        .join(", ")}.`,
      "illegal-containment",
    );
  }
}

/** Throws if moving `element` under `newParentId` would create a cycle. */
export function assertNoCycle(ws: Workspace, element: Element, newParentId: Ulid | null): void {
  let cursor = newParentId;
  while (cursor !== null) {
    if (cursor === element.id) {
      throw new ModelRuleError(
        `Cannot move "${element.name}" inside its own descendant.`,
        "containment-cycle",
      );
    }
    cursor = ws.element(cursor).parentId;
  }
}

/** Relationship endpoints must exist and must not be groups. */
export function assertLegalEndpoints(ws: Workspace, sourceId: Ulid, targetId: Ulid): void {
  for (const id of [sourceId, targetId]) {
    const el = ws.elements.get(id);
    if (!el) {
      throw new ModelRuleError(`Relationship endpoint does not exist: ${id}`, "unknown-endpoint");
    }
    if (el.kind === "group") {
      throw new ModelRuleError(
        `Groups are boundaries, not systems — connect "${el.name}"'s members instead.`,
        "illegal-endpoint",
      );
    }
  }
}
