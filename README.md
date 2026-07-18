# Atlas

A browser-based, model-first **C4 architecture modelling tool** — not a drawing tool.
The model is the source of truth; diagrams are projections of it. Inspired by the
interaction model of IcePanel, the metamodel rigour of Archi/ArchiMate, and the
source-control-friendly serialisation of Structurizr.

## Status

| Milestone | State |
|---|---|
| M0 — Foundations (metamodel, command bus, deterministic serialiser) | ✅ golden byte-identity test |
| M1 — 2D canvas & inspector | ✅ |
| M2 — C4 zoom & landscape (drill, breadcrumbs, "appears in") | ✅ |
| M3 — Isometric mode (shared scene graph, per-view toggle) | ✅ |
| M4 — Stencil packs (registry, attribute schemas, AWS/Azure/GCP/business packs) | ✅ |
| M5 — Automated views (connections ego-network, matrix, lint, impact) | ✅ |
| M6 — Time (scrubber, named states, overrides, diff overlay + report) | ✅ |
| M7 — AI chat (Anthropic tool use → command bus, Apply/Discard proposals) | ✅ |
| M8 — Supabase (schema+RLS, row mapping, realtime relay, file↔DB sync) | ✅ adapter + tests; live 2-browser run needs a provisioned Supabase project |
| M9 — Polish & interop | ✅ PNG/SVG/Mermaid/PlantUML export, Structurizr + ArchiMate import (best effort, [notes](docs/interop.md)), keyboard shortcuts, tag colour overlays, 1,000-element perf pass (core + UI) |

**Test suite:** 59 unit tests across `core`/`stencils`/`ai`/`cli`/`storage-supabase` plus
core perf thresholds, and 60 Playwright end-to-end journeys against the real UI
(including a 1,000-element load test).

### Deviations from the brief (with rationale)

- **Turborepo deferred** ([ADR 0001](docs/adr/0001-monorepo-tooling.md)) — `pnpm -r` suffices at this scale.
- **AI change preview is a list, not canvas ghosts** — the proposal card enumerates queued
  changes; ghost rendering on canvas is a v1.1 refinement. Undo/validation semantics match the brief exactly.
- **Iso mode is read-mostly** ([ADR 0003](docs/adr/0003-canvas-renderer.md)) — layout edits happen in 2D; iso selection/inspection works.
- **Cloud pack symbols are generated glyphs**, not trademarked provider icons; the manifest
  format accepts arbitrary SVG for custom packs.
- **M8 acceptance** partially machine-verifiable here: adapter, schema, RLS and mapping are
  tested; the interactive two-browser session requires user-provisioned Supabase credentials
  ([ADR 0004](docs/adr/0004-multi-user-sync.md)).

![Landscape view](docs/images/landscape.png)

*The landscape view: C4 palette, model tree, canvas with drill affordances, inspector.*

![Container view](docs/images/container-view.png)

*Drilled into a system: breadcrumbs, containers, and the inspector editing a shared model object.*

## Layout

- `packages/core` — `@atlas/core`: metamodel, command bus (undo/redo), JSON Schemas,
  deterministic serialiser, temporal engine, graph analysis, stencil registry,
  Mermaid/PlantUML exporters. Zero UI dependencies.
- `packages/stencils` — `@atlas/stencils`: built-in packs (C4 core, generic tech,
  business, AWS/Azure/GCP ≈40 stencils each).
- `packages/ai` — `@atlas/ai`: Anthropic tool-use turn mapped 1:1 to the command bus.
- `packages/cli` — `@atlas/cli`: `atlas validate | diff | export` for CI.
- `packages/storage-supabase` — `@atlas/storage-supabase`: normalised schema + RLS,
  row mapping, realtime command relay, file↔DB sync.
- `apps/web` — `@atlas/web`: React + Vite app (canvas, iso mode, model tree, inspector,
  analysis, timeline, AI chat).
- `docs/` — [research](docs/research.md), [ADRs](docs/adr/),
  [file format](docs/format/workspace-format.md),
  [stencil format](docs/stencil-format.md).

## Develop

```sh
pnpm install
pnpm test        # all package tests (core: vitest incl. golden byte-identity)
pnpm typecheck
pnpm dev         # web app
```

UK English throughout. All model mutations — UI, AI, CLI, sync — travel through the
command bus in `@atlas/core`; nothing else may touch the model.
