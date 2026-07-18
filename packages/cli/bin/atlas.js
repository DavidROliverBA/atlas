#!/usr/bin/env node
// Shim: run the TypeScript CLI via tsx (packages ship TS source — ADR 0001).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "run.ts");
const result = spawnSync("npx", ["tsx", entry, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
