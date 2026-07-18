/**
 * Metamodel rules: legal containment and relationship endpoints, enforced in
 * core so every mutation path (UI, AI, CLI, sync) gets the same errors
 * (Architecture Principle 3).
 */

import type { Ulid } from "../ids.js";
import type { Element, ElementKind, ViewKind } from "./types.js";
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
      | "illegal-placement"
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

/**
 * Which element kinds may appear on which diagram level. This is what makes
 * "when to use a stencil" unambiguous: people belong to context-level
 * diagrams; components (including every cloud-service stencil) belong to
 * component diagrams; boundaries go anywhere. Custom views are a mid-level
 * free canvas (systems, containers, boundaries).
 */
export const VIEW_PLACEMENT: Record<ViewKind, readonly ElementKind[]> = {
  landscape: ["person", "system", "group"],
  context: ["person", "system", "group"],
  container: ["system", "container", "group"],
  component: ["container", "component", "group"],
  custom: ["system", "container", "group"],
};

const VIEW_LABEL: Record<ViewKind, string> = {
  landscape: "landscape",
  context: "system context",
  container: "container",
  component: "component",
  custom: "custom",
};

/** Throws ModelRuleError if an element kind may not appear on a view kind. */
export function assertPlaceableOnView(viewKind: ViewKind, elementKind: ElementKind): void {
  if (VIEW_PLACEMENT[viewKind].includes(elementKind)) return;
  const allowedOn = (Object.keys(VIEW_PLACEMENT) as ViewKind[])
    .filter((v) => VIEW_PLACEMENT[v].includes(elementKind))
    .map((v) => VIEW_LABEL[v])
    .join(", ");
  throw new ModelRuleError(
    `A ${label(elementKind)} cannot appear on a ${VIEW_LABEL[viewKind]} view — use it on: ${allowedOn} views.`,
    "illegal-placement",
  );
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
