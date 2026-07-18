/**
 * Pack-building helpers. Built-in packs use generated glyphs (abbreviation on
 * a coloured tile) rather than trademarked provider icons; the manifest
 * format supports arbitrary SVG, so custom packs can ship real artwork.
 */

import type { ElementKind, Stencil, StencilCategory, StencilPack } from "@atlas/core";

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((n >> shift) & 0xff) * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

export function symbol2d(abbrev: string, color: string): string {
  return (
    `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="2" y="2" width="36" height="36" rx="9" fill="${color}"/>` +
    `<text x="20" y="24.5" text-anchor="middle" font-size="${abbrev.length > 3 ? 9 : 11}" font-weight="700" fill="#fff" font-family="system-ui,sans-serif">${abbrev}</text>` +
    `</svg>`
  );
}

export function symbolIso(abbrev: string, color: string): string {
  const light = shade(color, 1.25);
  const dark = shade(color, 0.7);
  return (
    `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">` +
    `<polygon points="20,3 37,12.5 20,22 3,12.5" fill="${light}"/>` +
    `<polygon points="3,12.5 20,22 20,38 3,28.5" fill="${color}"/>` +
    `<polygon points="37,12.5 20,22 20,38 37,28.5" fill="${dark}"/>` +
    `<text x="20" y="15.5" text-anchor="middle" font-size="${abbrev.length > 3 ? 7 : 9}" font-weight="700" fill="#1e293b" font-family="system-ui,sans-serif">${abbrev}</text>` +
    `</svg>`
  );
}

/** [id, name, categoryId, elementType, abbrev, defaultTechnology?] */
export type StencilTuple = [string, string, string, ElementKind, string, string[]?];

export interface PackSpec {
  id: string;
  name: string;
  description: string;
  color: string;
  categories: StencilCategory[];
  stencils: StencilTuple[];
  attributeSchema?: Record<string, unknown>;
}

export function definePack(spec: PackSpec): StencilPack {
  const stencils: Stencil[] = spec.stencils.map(([id, name, category, elementType, abbrev, technology]) => ({
    id,
    name,
    category,
    elementType,
    symbol2d: symbol2d(abbrev, spec.color),
    symbolIso: symbolIso(abbrev, spec.color),
    ...(technology ? { defaults: { technology } } : {}),
    ...(spec.attributeSchema && elementType !== "group" ? { attributeSchema: spec.attributeSchema } : {}),
  }));
  return {
    formatVersion: 1,
    id: spec.id,
    name: spec.name,
    version: "1.0.0",
    description: spec.description,
    categories: spec.categories,
    stencils,
  };
}
