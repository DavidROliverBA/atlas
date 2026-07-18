# ADR 0002: Workspace file format and deterministic serialisation

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The model must serialise to a git-friendly format where `git diff` reads as an
architectural change log (brief §3.8A, Principle 4).

## Decision

One JSON file per model object:

```
atlas.workspace.json           # manifest: formatVersion, name, stencilPacks
model/elements/<ulid>.json
model/relationships/<ulid>.json
views/<ulid>.json
states/<ulid>.json
```

Determinism rules, enforced by `@atlas/core/serialize` and guarded by a golden-file
byte-identity test:

1. Key order: fixed priority list (`formatVersion, id, kind, type, name, parentId,
   sourceId, targetId, scopeId, elementId`) then alphabetical, applied recursively.
2. 2-space indent (one property per line), LF endings, single trailing newline.
3. Set-like arrays sorted (tags, state memberships, hidden relationship ids,
   stencil pack list); ordered arrays (technology, owners, links, placements-by-elementId)
   keep meaningful order.
4. Optional empty collections and empty strings are omitted, not written as `[]`/`""`.
5. ULID identifiers, assigned once at creation; filenames are the ids.
6. No timestamps anywhere in the format.
7. `formatVersion: 1` in the manifest; any breaking change bumps it with a documented
   migration in `/docs/format/`.

Every file kind has a JSON Schema (2020-12) compiled with Ajv; loading validates schema
first, then referential integrity (parents, endpoints, scopes, placements, states).

## Alternatives considered

- **Single workspace file** (Structurizr-style): simpler open/save but merge conflicts
  concentrate in one file; per-object files give line-level *and* file-level diff locality.
- **YAML**: friendlier to hand-edit but whitespace-sensitive merges and multiple ways to
  write the same document undermine determinism.

## Consequences

- Renames are single-file diffs; adding a system is a file add — `git log --stat` reads
  as a change log.
- The serialiser must normalise on write (sorting, dropping empties), so a loaded-then-
  saved workspace is always byte-identical (round-trip test enforces this).
