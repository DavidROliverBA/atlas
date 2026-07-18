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

### ArchiMate Open Exchange — not yet implemented

Planned mapping (documented ahead of implementation, per the brief):
Business Actor → `person`; Application Component → `system`/`container` by nesting;
Node/Artifact → `container` with the generic-tech pack; groupings → `group`;
Serving/Flow/Triggering → relationships with tag `archimate:<type>`. Motivation and
Implementation layers have no Atlas equivalent and would import as tagged custom
properties. XML parsing lands with v1.1.
