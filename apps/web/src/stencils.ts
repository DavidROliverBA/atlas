/**
 * C4 Core palette definitions for the UI. The formal, data-driven stencil
 * pack loader arrives in M4 (see /docs/stencil-format.md); these mirror the
 * "c4-core" pack so the visual language is stable from M1.
 */

import type { ElementKind } from "@atlas/core";

export interface StencilDef {
  kind: ElementKind;
  label: string;
  hint: string;
  /** Tailwind classes for the node body. */
  nodeClass: string;
  /** Small swatch class for palette / tree / chips. */
  chipClass: string;
}

export const C4_STENCILS: StencilDef[] = [
  {
    kind: "person",
    label: "Person",
    hint: "A user or actor of the estate",
    nodeClass: "bg-violet-50 border-violet-400 text-violet-950",
    chipClass: "bg-violet-400",
  },
  {
    kind: "system",
    label: "Software System",
    hint: "A deployable system delivering value",
    nodeClass: "bg-sky-50 border-sky-400 text-sky-950",
    chipClass: "bg-sky-400",
  },
  {
    kind: "container",
    label: "Container",
    hint: "An app or data store inside a system",
    nodeClass: "bg-teal-50 border-teal-400 text-teal-950",
    chipClass: "bg-teal-400",
  },
  {
    kind: "component",
    label: "Component",
    hint: "A building block inside a container",
    nodeClass: "bg-amber-50 border-amber-400 text-amber-950",
    chipClass: "bg-amber-400",
  },
  {
    kind: "group",
    label: "Group / Boundary",
    hint: "A visual and organisational boundary",
    nodeClass: "bg-slate-50/60 border-slate-400 border-dashed text-slate-700",
    chipClass: "bg-slate-400",
  },
];

export const stencilFor = (kind: ElementKind): StencilDef =>
  C4_STENCILS.find((s) => s.kind === kind) ?? C4_STENCILS[1]!;

export const KIND_LABELS: Record<ElementKind, string> = {
  person: "Person",
  system: "Software System",
  container: "Container",
  component: "Component",
  group: "Group",
};
