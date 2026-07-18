# ADR 0001: Monorepo tooling — pnpm workspaces, no Turborepo yet

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The brief recommends pnpm workspaces + Turborepo, TypeScript strict throughout.

## Decision

pnpm workspaces with plain `pnpm -r` scripts; **defer Turborepo**. TypeScript strict
(`strict`, `noUncheckedIndexedAccess`) via a shared `tsconfig.base.json`. Vitest for
`@atlas/core`, Playwright for `apps/web`. Packages ship TypeScript source directly
(`main: src/index.ts`) and are consumed via the bundler (Vite) — no build step per
package until an external consumer needs one.

## Consequences

- Two packages and one app do not yet have a task graph worth caching; `pnpm -r` is
  sufficient and one less config to maintain. Revisit when build times or package count
  grow (tracked for M8, when `@atlas/storage-supabase` and `@atlas/cli` land).
- Source-shipping packages keeps the inner loop fast but means `tsc --noEmit` per
  package is the type gate; CI must run `pnpm -r typecheck`.
