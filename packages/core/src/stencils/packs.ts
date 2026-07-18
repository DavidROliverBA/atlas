/**
 * Stencil packs (§3.2): pluggable, data-driven vocabularies. A stencil maps
 * onto a core element kind — packs extend the drawable vocabulary without
 * ever extending the metamodel (Principle 7). Format: /docs/stencil-format.md.
 */

import { Ajv2020 as Ajv, type ValidateFunction } from "ajv/dist/2020.js";
import type { ElementKind, StencilRef } from "../metamodel/types.js";

export interface StencilCategory {
  id: string;
  name: string;
}

export interface Stencil {
  id: string;
  name: string;
  category: string;
  /** The core kind this stencil maps onto — rules always come from the kind. */
  elementType: ElementKind;
  /** Inline SVG markup for the flat symbol (viewBox 0 0 40 40). */
  symbol2d: string;
  /** Inline SVG markup for the isometric symbol (viewBox 0 0 40 40). */
  symbolIso: string;
  /** Initial values applied at creation. */
  defaults?: { technology?: string[]; tags?: string[]; description?: string };
  /** JSON Schema (2020-12) for pack-specific attributes. */
  attributeSchema?: Record<string, unknown>;
}

export interface StencilPack {
  formatVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  categories: StencilCategory[];
  stencils: Stencil[];
}

/** Pack reference stored in a workspace manifest, e.g. "aws@1". */
export function packRef(pack: StencilPack): string {
  return `${pack.id}@${pack.version.split(".")[0]}`;
}

export class StencilRegistry {
  private packs = new Map<string, StencilPack>();
  private validators = new Map<string, ValidateFunction>();
  private ajv = new Ajv({ allErrors: true, strict: false });

  register(pack: StencilPack): void {
    if (this.packs.has(pack.id)) throw new Error(`Stencil pack already registered: ${pack.id}`);
    const seen = new Set<string>();
    for (const stencil of pack.stencils) {
      if (seen.has(stencil.id)) {
        throw new Error(`Duplicate stencil id "${stencil.id}" in pack "${pack.id}"`);
      }
      seen.add(stencil.id);
      if (!pack.categories.some((c) => c.id === stencil.category)) {
        throw new Error(`Stencil "${stencil.id}" uses unknown category "${stencil.category}"`);
      }
      if (stencil.attributeSchema) {
        this.validators.set(`${pack.id}/${stencil.id}`, this.ajv.compile(stencil.attributeSchema));
      }
    }
    this.packs.set(pack.id, pack);
  }

  all(): StencilPack[] {
    return [...this.packs.values()];
  }

  pack(id: string): StencilPack | undefined {
    return this.packs.get(id);
  }

  stencil(ref: StencilRef): Stencil | undefined {
    return this.packs.get(ref.pack)?.stencils.find((s) => s.id === ref.stencil);
  }

  /**
   * Validate a stencil reference and its attributes. Unknown packs are not an
   * error (a workspace may reference packs this install doesn't have — the
   * element still renders via its kind); unknown stencils in a known pack are.
   */
  validateRef(ref: StencilRef): string[] {
    const pack = this.packs.get(ref.pack);
    if (!pack) return [];
    const stencil = pack.stencils.find((s) => s.id === ref.stencil);
    if (!stencil) return [`Unknown stencil "${ref.stencil}" in pack "${ref.pack}"`];
    if (ref.attributes) {
      const validate = this.validators.get(`${ref.pack}/${ref.stencil}`);
      if (validate && !validate(ref.attributes)) {
        return (validate.errors ?? []).map(
          (e) => `${stencil.name}${e.instancePath ? ` ${e.instancePath}` : ""} ${e.message ?? "is invalid"}`,
        );
      }
    }
    return [];
  }
}
