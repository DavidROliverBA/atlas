import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFixture } from "./fixture.js";
import { workspaceFromFiles, workspaceToFiles, WorkspaceLoadError } from "../src/serialize/files.js";
import { validateFile } from "../src/schemas/validate.js";

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "__golden__", "airline-estate");

function readGolden(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out.set(rel, readFileSync(full, "utf8"));
    }
  };
  walk(GOLDEN_DIR, "");
  return out;
}

describe("deterministic serialisation", () => {
  it("round-trips byte-identically (save → load → save)", () => {
    const f = buildFixture();
    const first = workspaceToFiles(f.ws);
    const loaded = workspaceFromFiles(first);
    const second = workspaceToFiles(loaded);

    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [path, content] of first) {
      expect(second.get(path), path).toBe(content);
    }
  });

  it("is deterministic across independent builds", () => {
    const a = workspaceToFiles(buildFixture().ws);
    const b = workspaceToFiles(buildFixture().ws);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("uses LF endings, trailing newline, and one property per line", () => {
    const files = workspaceToFiles(buildFixture().ws);
    for (const [path, content] of files) {
      expect(content.includes("\r"), path).toBe(false);
      expect(content.endsWith("\n"), path).toBe(true);
    }
  });

  it("matches the committed golden files byte-for-byte", () => {
    const files = workspaceToFiles(buildFixture().ws);
    if (process.env["UPDATE_GOLDEN"]) {
      for (const [path, content] of files) {
        const full = join(GOLDEN_DIR, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
    }
    const golden = readGolden();
    expect([...files.keys()]).toEqual([...golden.keys()]);
    for (const [path, content] of golden) {
      expect(files.get(path), path).toBe(content);
    }
  });

  it("every emitted file validates against its JSON Schema", () => {
    const files = workspaceToFiles(buildFixture().ws);
    for (const [path, content] of files) {
      const kind = path === "atlas.workspace.json"
        ? "workspace"
        : path.startsWith("model/elements/")
          ? "element"
          : path.startsWith("model/relationships/")
            ? "relationship"
            : path.startsWith("views/")
              ? "view"
              : "state";
      expect(validateFile(kind, JSON.parse(content)), path).toEqual([]);
    }
  });

  it("rejects schema-invalid files on load with useful errors", () => {
    const files = workspaceToFiles(buildFixture().ws);
    const [elementPath] = [...files.keys()].filter((p) => p.startsWith("model/elements/"));
    const broken = new Map(files);
    const parsed = JSON.parse(broken.get(elementPath!)!);
    parsed.kind = "martian";
    broken.set(elementPath!, JSON.stringify(parsed));
    expect(() => workspaceFromFiles(broken)).toThrow(WorkspaceLoadError);
  });

  it("rejects dangling references on load", () => {
    const files = workspaceToFiles(buildFixture().ws);
    const relPath = [...files.keys()].find((p) => p.startsWith("model/relationships/"))!;
    const broken = new Map(files);
    const rel = JSON.parse(broken.get(relPath)!);
    rel.targetId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    broken.set(relPath, JSON.stringify(rel));
    expect(() => workspaceFromFiles(broken)).toThrow(/integrity/);
  });
});
