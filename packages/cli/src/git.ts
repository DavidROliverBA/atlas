/**
 * Git-backed workspace materialisation for `atlas diff --git <a>..<b>
 * [path]` (§CLI). Streams `git archive <ref>` straight into `tar` to
 * extract a ref's workspace subtree into a fresh temp directory — no
 * working-tree checkout, and the caller's actual checkout is never touched —
 * so the result is just another directory `diffDirs` can compare.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BUFFER = 1024 * 1024 * 256; // 256 MB — generous for a model workspace's JSON files.

/**
 * Materialise `ref`'s tree (optionally scoped to `path`) into a new temp
 * directory and return the directory that actually holds the workspace
 * files — `git archive` preserves the path prefix inside the tarball, so
 * when `path` is given the returned directory is `<tmp>/<path>`, not
 * `<tmp>` itself.
 */
export function materialiseGitRef(cwd: string, ref: string, path?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-diff-"));
  const scoped = path && path !== ".";
  const args = scoped ? ["archive", ref, "--", path] : ["archive", ref];
  const tarball = execFileSync("git", args, { cwd, maxBuffer: MAX_BUFFER });
  execFileSync("tar", ["-x", "-C", dir], { input: tarball, maxBuffer: MAX_BUFFER });
  return scoped ? join(dir, path) : dir;
}

/** Parse `"<a>..<b>"` into its two refs. Git ref names can never contain
 * `..`, so a plain split is always unambiguous. */
export function parseGitRange(range: string): { refA: string; refB: string } | null {
  const [refA, refB, ...rest] = range.split("..");
  if (!refA || !refB || rest.length > 0) return null;
  return { refA, refB };
}
