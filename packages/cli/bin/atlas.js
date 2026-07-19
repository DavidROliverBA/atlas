#!/usr/bin/env node
// Prefers the built output (packages/cli/dist, produced by `pnpm build`): a
// direct `node` invocation of already-compiled JS, no tsx subprocess, so a
// published/globally-installed `atlas` runs instantly and doesn't need
// TypeScript at runtime. Falls back to running the source straight through
// tsx when dist/ hasn't been built yet, so the inner dev loop
// (`pnpm --filter @atlas/cli exec atlas ...`, or `pnpm --filter @atlas/cli
// dev`) still works with no build step (ADR 0001: source-shipping packages
// keep the loop fast).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, "../dist/index.js");

if (existsSync(built)) {
  const { run } = await import(built);
  process.exit(run(process.argv.slice(2)));
} else {
  const { spawnSync } = await import("node:child_process");
  const entry = join(here, "run.ts");
  const result = spawnSync("npx", ["tsx", entry, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
