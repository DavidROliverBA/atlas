# Interoperability (§3.9)

## Exports

| Format | Where | Notes |
|---|---|---|
| Native file bundle | Web toolbar → Export, CLI | The canonical git-friendly format (ADR 0002); DB workspaces export identically via `SupabaseStorageAdapter.exportToFiles()` |
| SVG | Web toolbar → Export menu; `toSvg(ws, viewId)` in core | Standalone, deterministic rendering of one view's scene graph (boxes + connectors). Use any SVG→PNG tool for raster output |
| Mermaid C4 | `atlas export <dir> --format=mermaid [--view=…]`; `toMermaidC4` | `C4Context` block; groups map to `System_Boundary` |
| PlantUML C4 | `atlas export <dir> --format=plantuml`; `toPlantUmlC4` | Includes the matching C4-PlantUML stdlib file per view level; groups are skipped (boundary nesting is v1.1) |

## Imports

### Structurizr JSON (best effort) — `importStructurizr(json, ids)`

| Structurizr | Atlas | Notes |
|---|---|---|
| `model.people[]` | `person` elements | tags imported minus the built-in Structurizr tags |
| `model.softwareSystems[]` | `system` elements | |
| `…containers[]` | `container` (parent = system) | comma-separated `technology` → list |
| `…components[]` | `component` (parent = container) | |
| element `relationships[]` | relationships | `description` → verb, `technology` → list |
| views, styles, layout | **not mapped** | one auto-laid-out landscape view is generated; Structurizr's per-view geometry, styles and animations have no stable Atlas equivalent |
| deployment nodes, documentation, ADRs | **not mapped** | out of scope for v1 |

Dangling relationships or illegal containment become warnings, never a failed import.

### ArchiMate Open Exchange (best effort) — `importArchimate(xml, ids)`

| ArchiMate | Atlas | Notes |
|---|---|---|
| BusinessActor / BusinessRole | `person` | tagged `archimate:<type>` |
| ApplicationComponent / ApplicationCollaboration / ApplicationService | `system` | |
| Node / Device / SystemSoftware / Artifact | `system` | pair with the generic-tech pack for symbols |
| Grouping | `group` | |
| any relationship between imported elements | relationship | verb = relationship name or lowercased type; tagged `archimate:<type>` |
| Motivation / Implementation layers, BusinessProcess etc. | **warning, skipped** | no stable Atlas equivalent in v1 |
| views, composition-as-containment | **not mapped** | one auto landscape is generated; nesting via Composition is a v1.1 refinement |

Both importers are reachable from the toolbar **Import** button (which auto-detects
Atlas bundles, Structurizr JSON, and ArchiMate XML) and never fail on partial input —
unmappable content becomes warnings.

## Performance (M9 pass)

- Core: 1,000 elements / 300 relationships build through the command bus, serialise to
  1,302 files, reload with full schema validation, and re-serialise byte-identically —
  guarded by thresholds in `packages/core/test/perf.test.ts` (actual runtime: milliseconds).
- UI: a 1,000-element workspace with 150 elements placed on one view loads, renders,
  and stays interactive (selection, tag overlay, temporal filter) — guarded by
  `apps/web/e2e/perf.spec.ts`.
