import { expect, test } from "@playwright/test";

/**
 * M9 UI performance pass: a 1,000-element workspace (150 placed on the
 * landscape — a heavy view by C4 standards) must load, render and stay
 * interactive.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(n: number): string {
  let suffix = "";
  let value = n;
  for (let i = 0; i < 24; i++) {
    suffix = ALPHABET[value % 32] + suffix;
    value = Math.floor(value / 32);
  }
  return `01${suffix}`;
}

function bigWorkspace(): Record<string, string> {
  const files: Record<string, string> = {
    "atlas.workspace.json": JSON.stringify({ formatVersion: 1, name: "Big estate" }),
  };
  const systemIds: string[] = [];
  let counter = 1;
  for (let s = 0; s < 200; s++) {
    const id = ulid(counter++);
    systemIds.push(id);
    files[`model/elements/${id}.json`] = JSON.stringify({
      id,
      kind: "system",
      name: `System ${s}`,
      parentId: null,
      tags: s % 5 === 0 ? ["legacy"] : ["core"],
    });
    for (let c = 0; c < 4; c++) {
      const cid = ulid(counter++);
      files[`model/elements/${cid}.json`] = JSON.stringify({
        id: cid,
        kind: "container",
        name: `System ${s} / Container ${c}`,
        parentId: id,
      });
    }
  }
  // 300 relationships between consecutive systems.
  for (let s = 0; s < 300; s++) {
    const id = ulid(counter++);
    files[`model/relationships/${id}.json`] = JSON.stringify({
      id,
      sourceId: systemIds[s % 200],
      targetId: systemIds[(s + 1) % 200],
      name: "calls",
    });
  }
  const viewId = ulid(counter++);
  files[`views/${viewId}.json`] = JSON.stringify({
    id: viewId,
    kind: "landscape",
    name: "Landscape",
    scopeId: null,
    placements: systemIds.slice(0, 150).map((elementId, i) => ({
      elementId,
      x: (i % 12) * 13,
      y: Math.floor(i / 12) * 8,
    })),
  });
  return files;
}

test.describe("performance (M9)", () => {
  test("a 1,000-element workspace loads and stays interactive", async ({ page }) => {
    const files = bigWorkspace();
    await page.addInitScript((record: Record<string, string>) => {
      localStorage.setItem("atlas.workspace.v1", JSON.stringify(record));
    }, files);

    const start = Date.now();
    await page.goto("/");
    await expect(page.locator(".react-flow__node")).toHaveCount(150, { timeout: 20_000 });
    const loadMs = Date.now() - start;
    expect(loadMs).toBeLessThan(15_000);

    // The model tree carries the full 1,000 elements.
    await expect(page.getByTestId("tree-System 0")).toBeVisible();
    await expect(page.getByTestId("tree-System 199")).toBeVisible();

    // Interactions stay responsive: select + inspect, temporal filter, tag overlay.
    await page.locator('[data-testid="canvas-node"][data-elname="System 42"]').click();
    await expect(page.getByTestId("inspector-name")).toHaveValue("System 42");

    const t0 = Date.now();
    await page.getByTestId("tag-overlay").selectOption("legacy");
    await expect(
      page.locator('[data-testid="canvas-node"][data-elname="System 0"]'),
    ).toHaveAttribute("data-tagged", "true");
    expect(Date.now() - t0).toBeLessThan(5_000);
  });
});
