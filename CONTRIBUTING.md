# Contributing to Atlas

## Prerequisites

- **Node** 22 (matches CI — see `.github/workflows/ci.yml`).
- **pnpm** 9.15.9 (pinned via `packageManager` in the root `package.json`). Use `pnpm`
  / `pnpm dlx` — **not** `npm`/`npx`/`yarn`. If you don't have pnpm yet:
  `corepack enable` (Node ships Corepack; it reads `packageManager` and installs the
  right pnpm for you).
- **git** (the CLI's `atlas diff --git` mode shells out to `git archive`/`tar`).

## Install

```sh
pnpm install
```

This is a pnpm workspace (`pnpm-workspace.yaml`): one lockfile, one `node_modules`
layout, for every package under `packages/*` and `apps/*`.

## Repository layout

| Package | Name | What it is |
|---|---|---|
| `packages/core` | `@atlas/core` | Metamodel, command bus (undo/redo), JSON Schemas, deterministic serialiser, temporal engine, TCO engine, graph analysis, stencil registry, Mermaid/PlantUML/SVG exporters. Zero UI dependencies. |
| `packages/stencils` | `@atlas/stencils` | Built-in stencil packs (C4 core, generic tech, business, AWS/Azure/GCP, AI Agents). |
| `packages/ai` | `@atlas/ai` | Anthropic tool-use turns mapped 1:1 onto the command bus. |
| `packages/cli` | `@atlas/cli` | `atlas validate \| diff \| export` for CI and scripting. |
| `packages/storage-supabase` | `@atlas/storage-supabase` | Normalised Postgres schema + RLS, row mapping, atomic optimistic-concurrency saves. |
| `apps/web` | `@atlas/web` | React + Vite app, plus the Cloudflare Pages Functions serving the REST API and the AI proxy. |
| `docs/` | — | [User guide](docs/user-guide.md), [API guide](docs/api.md), [operations runbook](docs/operations.md), [ADRs](docs/adr/), [file format](docs/format/workspace-format.md), [stencil format](docs/stencil-format.md). |

Packages ship TypeScript source directly (`main`/`exports` point at `src/`) and are
consumed through a bundler (Vite for the app, esbuild for the CLI's published `bin`) —
no build step per package unless something outside the workspace needs to run the
compiled output directly (see `packages/cli/package.json`'s `build` script and ADR
0001).

## Everyday commands

```sh
pnpm install         # once, or whenever a package.json changes
pnpm -r typecheck     # tsc --noEmit across every package (the type gate — packages ship source, not builds)
pnpm -r test          # every package's unit tests (vitest)
pnpm dev              # web app dev server, http://localhost:5199
pnpm build            # pnpm -r build (currently just the web app + the CLI's bin bundle)
```

Scoping to one package: `pnpm --filter @atlas/core test`, `pnpm --filter @atlas/web dev`, etc.

### Web app specifics (`apps/web`)

```sh
pnpm --filter @atlas/web dev                 # dev server on :5199
pnpm --filter @atlas/web run typecheck:functions   # typecheck the Cloudflare Pages Functions separately
pnpm --filter @atlas/web run test:functions        # API contract tests (vitest, in-process — no network)
npx playwright test                          # end-to-end tests (from apps/web) — builds nothing, drives the dev server
npx playwright test e2e/smoke.spec.ts        # a single spec, useful while iterating
pnpm --filter @atlas/web build               # production build (vite build) — verify this before touching anything build-related
pnpm --filter @atlas/web run deploy          # vite build + wrangler pages deploy (see docs/operations.md — normally CI's job, not yours)
```

Playwright's config (`apps/web/playwright.config.ts`) spins up `pnpm dev` itself unless
a dev server is already running on `:5199` and `CI` isn't set, so you usually don't
need to start one by hand.

### CLI specifics (`packages/cli`)

- `pnpm --filter @atlas/cli dev` runs the CLI straight from TypeScript source via
  `tsx` — no build step, fast inner loop.
- `pnpm --filter @atlas/cli build` bundles `src/index.ts` (and everything it imports,
  including `@atlas/core`) into a single self-contained `dist/index.js` with esbuild —
  this is what the published `bin/atlas.js` shim prefers when it exists, falling back
  to the `tsx`-via-source path when it doesn't. Rebuild after changing CLI source if
  you want to test the "real", no-tsx execution path.
- `pnpm --filter @atlas/cli test` — extend `test/cli.test.ts` for new commands. The
  `atlas diff --git <a>..<b>` mode is tested against a scratch git repo created in a
  temp dir (two commits of a tiny workspace) — see `makeGitFixture()` in that file for
  the pattern to follow if you add more git-backed behaviour.

## ⚠️ Browser-local mode is the safe default — DB mode points at PRODUCTION

Atlas has two workspace sources, switched from the toolbar (`workspace-source`):

- **Browser-local** (the default): the model lives in `localStorage`. Safe to break,
  reset (**Reset demo**), and experiment with freely.
- **Shared database**: the app talks to the *actual production* Supabase project
  (`apps/web/src/supabase.ts` hardcodes the project URL and anon key — there is no
  separate dev/staging Supabase project). Switching to DB mode in a local dev checkout
  reads and **writes the live shared workspace** that the deployed app and its real
  users see. There is currently no environment split, so:
  - Don't switch to DB mode while developing unless you specifically mean to test
    against production data, and know what you're doing.
  - Never point ad hoc scripts, the CLI, or curl at
    `https://atlas-modelling.pages.dev/api/v1/...` with a real token unless you intend
    the change to land in production.
  - See [`docs/operations.md`](docs/operations.md) for the secrets that unlock DB mode
    and the API, and how to rotate them if one leaks.

## Tests

- **Unit tests** (`packages/*`, vitest): metamodel invariants, command bus undo/redo,
  serialisation round trips (including byte-identical golden tests), row mapping,
  CLI behaviour. Run with `pnpm -r test`.
- **API contract tests** (`apps/web/functions-test`, vitest): exercise the real
  Cloudflare Pages Functions router against an in-memory Supabase stand-in — no
  network, no real database. Run with `pnpm --filter @atlas/web run test:functions`.
- **End-to-end tests** (`apps/web/e2e`, Playwright): drive the real UI in a real
  browser against the real dev server. Database-mode journeys stub the API with
  `page.route` (see `e2e/db-roundtrip.spec.ts`) so they never touch the production
  Supabase project. Run with `npx playwright test` from `apps/web`; CI shards these
  2-way (`--shard=1/2` / `--shard=2/2`).

CI (`.github/workflows/ci.yml`) runs typechecking, every unit/contract test suite, and
the full sharded e2e suite on every push and pull request — treat a red CI run the same
whether it's from a push or a PR.

## Conventions

- **UK English throughout** — comments, docs, commit messages, UI copy (`colour`,
  `organise`, `licence` as a noun, `-ise` not `-ize`).
- **The command bus is the only way to touch the model.** Every mutation — from the
  UI, the AI assistant, the CLI, the REST API, or DB-mode sync — goes through
  `CommandBus` in `@atlas/core`. If you're adding a way to change the model and it
  isn't dispatching a `Command` through the bus, it's wrong: the metamodel validation,
  undo/redo, and API/CLI/AI parity all depend on this being the single path.
- Match the file you're editing: read the surrounding code's conventions (naming,
  error-message style, test structure) before introducing a new pattern. Several
  packages have their own `README`-equivalent context in `docs/adr/` — check there for
  the reasoning behind a structural choice before changing it.
