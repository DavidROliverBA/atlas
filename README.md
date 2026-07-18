# Atlas

A browser-based, model-first **C4 architecture modelling tool** — not a drawing tool.
The model is the source of truth; diagrams are projections of it. Inspired by the
interaction model of IcePanel, the metamodel rigour of Archi/ArchiMate, and the
source-control-friendly serialisation of Structurizr.

## Status

| Milestone | State |
|---|---|
| M0 — Foundations (metamodel, command bus, deterministic serialiser) | ✅ |
| M1 — 2D canvas & inspector | 🚧 |
| M2+ | planned |

## Layout

- `packages/core` — `@atlas/core`: metamodel, command bus (undo/redo), JSON Schemas,
  deterministic serialiser, temporal engine, graph analysis. Zero UI dependencies.
- `apps/web` — `@atlas/web`: React + Vite app (canvas, model tree, inspector).
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
