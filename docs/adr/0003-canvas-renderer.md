# ADR 0003: 2D canvas on React Flow; isometric as a sibling renderer over the same scene graph

- **Status:** Accepted (revisit before M3 completion, per brief §4)
- **Date:** 2026-07-18

## Context

The brief defaults to React Flow (xyflow) for 2D with a custom isometric renderer, and
asks for an ADR if React Flow proves too constraining.

## Decision

- **2D:** React Flow (`@xyflow/react`) with fully custom nodes/edges for the IcePanel
  aesthetic. It provides pan/zoom, drag, selection, edge routing and connection UX that
  would cost weeks to rebuild.
- **Scene graph:** views store placements in abstract **grid units** (1 unit = 20 px in
  2D). React Flow positions are derived (unit × 20) and written back through
  `updatePlacement` on drag end. Renderers never touch the model directly.
- **Isometric:** a separate SVG renderer consuming the same placements, projecting grid
  coordinates with the standard 2:1 dimetric transform (`x' = (x−y)·cos30°,
  y' = (x+y)·sin30° − z`). It is read-mostly in v1 (select + inspect; layout edits happen
  in 2D or via drag mapped back through the inverse projection).

## Consequences

- One scene graph, two projections — the iso toggle cannot drift from 2D because there is
  no second layout store.
- Risk: React Flow's DOM-node model caps very large diagrams (~1k nodes). Acceptable for
  v1 (brief's performance target is a 1,000-element model, per-view counts are far
  smaller). If exceeded, the documented escape hatch is a PixiJS canvas renderer behind
  the same scene-graph interface.
