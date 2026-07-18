# Atlas workspace file format (formatVersion 1)

A workspace is a directory. Paths are fixed; filenames are the object's ULID.

```
atlas.workspace.json           # manifest
model/elements/<ulid>.json     # one file per element
model/relationships/<ulid>.json
views/<ulid>.json
states/<ulid>.json
stencils/                      # enabled pack refs + custom packs (from M4)
```

Determinism rules are specified in [ADR 0002](../adr/0002-file-format.md). The
normative JSON Schemas live in `@atlas/core` (`src/schemas/schemas.ts`, exported as
`schemas`) and are validated with Ajv on every load; `atlas validate` runs the same
checks in CI. A committed example of the exact bytes the serialiser produces is the
golden fixture at `packages/core/test/__golden__/airline-estate/`.

## File kinds

### atlas.workspace.json
| Field | Type | Notes |
|---|---|---|
| `formatVersion` | `1` | breaking changes bump this; migrations documented here |
| `name` | string | workspace display name |
| `description` | string? | |
| `stencilPacks` | string[]? | enabled pack ids, sorted |

### model/elements/*.json
Required: `id` (ULID), `kind` (`person | system | container | component | group`),
`name`, `parentId` (ULID or `null` — containment is a model property).
Optional: `description`, `documentation` (Markdown), `technology[]`, `owners[]`,
`team`, `status` (`proposed | planned | live | deprecated | decommissioned`),
`criticality` (`low | medium | high | critical`), `tags[]` (sorted), `links[]`
(`{title, url}`), `properties` (string map), `stencil` (`{pack, stencil, attributes}`),
`temporal` (`{validFrom?, validTo?, states[]?}` — ISO dates, sorted state ids),
`stateOverrides` (state id → `{name?, description?, technology?, status?, tags?}`).

### model/relationships/*.json
Required: `id`, `sourceId`, `targetId`. Optional: `name` (verb phrase), `description`,
`technology[]`, `direction` (`forward | bidirectional`), `tags[]`, `properties`,
`temporal`. Endpoints may not be groups.

### views/*.json
Required: `id`, `kind` (`landscape | context | container | component | custom`),
`name`, `scopeId` (element the view is about; `null` for landscape/custom),
`placements[]` (`{elementId, x, y, width?, height?}` in grid units, sorted by
elementId). Optional: `description`, `renderMode` (`2d | isometric`),
`hiddenRelationshipIds[]`. Views never contain model data — only references
and geometry.

### states/*.json
Required: `id`, `name`. Optional: `date` (ISO date anchor), `description`.

## Referential integrity (checked after schema validation)

- `parentId`, relationship endpoints, `scopeId`, `placements[].elementId`,
  `hiddenRelationshipIds[]` must resolve.
- `temporal.states[]` and `stateOverrides` keys must be existing state ids.

## Containment rules (metamodel)

| Kind | Legal resolved scope |
|---|---|
| person, system | top level |
| container | inside a system |
| component | inside a container |
| group | top level, system, or container (groups are transparent to scope resolution) |
