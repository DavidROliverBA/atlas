# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Atlas is a model-first C4 architecture modelling tool: elements exist once in a shared model and diagrams are projections of it. `CONTRIBUTING.md` is the fuller developer guide; `docs/adr/` holds the reasoning behind structural choices — check there before changing one.

## Commands

pnpm workspace (pnpm 9.15.9 via `packageManager`, Node 22). Use `pnpm` / `pnpm dlx`, not npm/npx/yarn/bun.

```sh
pnpm install
pnpm -r typecheck                                   # the type gate — packages ship source, not builds
pnpm -r test --filter '!@atlas/web'                 # unit tests (vitest) for core, stencils, ai, cli, storage
pnpm --filter @atlas/core test                      # one package
pnpm --filter @atlas/core exec vitest run test/temporal.test.ts   # one test file (add -t "name" for one test)
pnpm dev                                            # web app on http://localhost:5199 (strictPort)

# apps/web
pnpm --filter @atlas/web run typecheck:functions    # Pages Functions have their own tsconfig — CI checks them separately
pnpm --filter @atlas/web run test:functions         # API contract tests against the real router + in-memory Supabase fake
pnpm --filter @atlas/web exec playwright test e2e/smoke.spec.ts   # one e2e spec; Playwright starts the dev server itself
pnpm --filter @atlas/web build                      # production build

# CLI
pnpm --filter @atlas/cli dev -- validate <dir>      # runs from TS source via tsx
```

`pnpm -r test` without the filter also runs the full Playwright suite (it is `@atlas/web`'s `test` script).

Golden serialisation fixtures (`packages/core/test/__golden__/airline-estate/`) must match byte-for-byte. Only regenerate them for an intentional format change: `UPDATE_GOLDEN=1 pnpm --filter @atlas/core exec vitest run test/serialize.test.ts`, then review the diff.

CI (`.github/workflows/ci.yml`) runs typecheck → unit + functions tests → 2-way sharded e2e → Cloudflare Pages deploy on `main`. Deploying is CI's job; don't run `pnpm --filter @atlas/web run deploy` unless asked.

## Architecture

**The command bus is the only way to touch the model.** Every mutation — UI, AI assistant, CLI, REST API, DB-mode sync — dispatches a `Command` through `CommandBus` (`packages/core/src/commands/bus.ts`). The bus enforces the metamodel rules (`metamodel/rules.ts`: containment, endpoints, cycles, per-view placement), computes exact inverse commands for undo/redo, and applies `batch` commands atomically as one undo step. New ways of changing the model must add a `Command` variant (`commands/commands.ts`), not mutate `Workspace` directly. In commands, `null` means "remove this optional field" (commands must stay JSON-serialisable), except for `parentId`/`scopeId` where `null` is a real "top level" value.

Package dependency direction: `@atlas/core` (zero UI deps) ← `stencils`, `ai`, `cli`, `storage-supabase` ← `apps/web`. Packages export `src/index.ts` directly and are bundled by Vite (app) or esbuild (CLI `dist/`) — there is no per-package build step.

- **Serialisation** (`core/src/serialize/`): one canonical JSON file per object (`atlas.workspace.json` + `model/elements|relationships`, `views`, `states` keyed by ULID). Output is deterministic and byte-stable across round trips; `stringifyCanonical` owns key ordering. Every file kind has a JSON Schema validated with Ajv (`schemas/`).
- **Temporal + TCO** (`core/src/temporal/engine.ts`, `analysis/tco.ts`): elements carry validity dates and named-state membership, with per-state attribute overrides. Visibility and the effective element are always derived through a `TemporalContext` — read through `visibleElements` / `effectiveElement`, not raw fields. Costs roll up through containment without double counting.
- **Stencils** (`packages/stencils`): packs register typed attribute schemas in a `StencilRegistry`, which is passed into the bus so attributes are validated on every write path. Packs are referenced in the manifest as `id@version`.
- **AI** (`packages/ai`): Anthropic tool calls run against a *planning clone* of the workspace via `ChangeSetBuilder`, so later calls see earlier creations and get real validation errors. The resulting commands become one `batch` the user Applies or Discards. The browser SDK points at the `/api/anthropic/v1/messages` proxy; the real key is only a server secret.
- **Web app** (`apps/web/src`): a Zustand store (`store.ts`) owns the `Workspace` + `CommandBus` pair and bumps a `rev` counter on change; components read model data straight from the workspace. The canvas is React Flow with custom nodes. Placements are stored in grid units (1 unit = 20 px) and pixel positions are derived. ELK auto-layout is lazily imported.
- **Workspace sources**: browser-local (`localStorage`, the default) or shared database. In DB mode, `dbsync.ts` loads `GET /api/v1/workspace` and pushes every local command (including undo/redo inverses), serialised in order, to `POST /api/v1/commands`.
- **REST API** (`apps/web/functions/api/v1/[[path]].ts`, Cloudflare Pages Function): loads the workspace, dispatches through the same bus, and persists via `@atlas/storage-supabase`. That package keeps a normalised Postgres schema that mirrors the file format one-to-one (`rows.ts`) and uses atomic saves with revision-based optimistic concurrency (`RevisionConflictError`). The OpenAPI 3.1 spec lives in `openapi-spec.ts`; keep it in step with router changes.

## Gotchas

- **There is no dev/staging database.** `apps/web/src/supabase.ts` and `functions/api/config.ts` hardcode the production Supabase project, and the project-scoped Supabase MCP server in `.mcp.json` targets it too. Switching the app to DB mode, calling `https://atlas-modelling.pages.dev/api/v1` with a real token, or running SQL through the MCP server all change live data. E2E tests stub the API with `page.route` (see `e2e/db-roundtrip.spec.ts`); follow that pattern.
- Migrations live in `packages/storage-supabase/supabase/migrations/`; `schema.sql` is the consolidated schema. Secrets, rotation and migration procedure are in `docs/operations.md`.
- `apps/web/public/_headers` (CSP) only applies on Cloudflare Pages, not under `vite dev` or `vite preview`. `'unsafe-eval'` is a temporary concession because Ajv compiles schemas at boot; replacing it is in `docs/improvement-backlog.md`.
- `secrets/` is gitignored and holds credentials; don't read it or copy anything out of it.
- UK English everywhere: code comments, docs, commit messages and UI copy (`colour`, `organise`, `-ise`).
