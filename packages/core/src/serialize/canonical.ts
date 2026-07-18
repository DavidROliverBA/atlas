/**
 * Deterministic serialisation (Architecture Principle 4).
 *
 * The file format is a contract designed so `git diff` reads as an
 * architectural change log:
 *  - stable key order (a priority list, then alphabetical),
 *  - one property per line (2-space pretty-printed JSON),
 *  - LF line endings and a trailing newline,
 *  - set-like arrays (tags, state memberships) sorted,
 *  - optional empty collections omitted entirely.
 */

/** Keys that sort ahead of everything else, in this order. */
const KEY_PRIORITY = [
  "formatVersion",
  "id",
  "kind",
  "type",
  "name",
  "parentId",
  "sourceId",
  "targetId",
  "scopeId",
  "elementId",
] as const;

const PRIORITY_INDEX = new Map<string, number>(KEY_PRIORITY.map((k, i) => [k, i]));

export function compareKeys(a: string, b: string): number {
  const pa = PRIORITY_INDEX.get(a);
  const pb = PRIORITY_INDEX.get(b);
  if (pa !== undefined && pb !== undefined) return pa - pb;
  if (pa !== undefined) return -1;
  if (pb !== undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareKeys(a, b));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = canonicalise(v);
    return out;
  }
  return value;
}

/** Canonical JSON text: sorted keys, 2-space indent, LF, trailing newline. */
export function stringifyCanonical(value: unknown): string {
  return JSON.stringify(canonicalise(value), null, 2) + "\n";
}

/** Sort a set-like string array (returns a new array; undefined stays undefined). */
export function sortedSet(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  return [...values].sort();
}

/** Return undefined for empty arrays/objects so optional collections vanish from files. */
export function dropEmpty<T extends object | unknown[]>(value: T | undefined): T | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.length ? value : undefined;
  return Object.keys(value).length ? value : undefined;
}
