import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { canvasNode, connectNodes, freshApp, rfNode, settle } from "./helpers";

/**
 * Export → import round-trip proof for the UI's "workspace bundle (.json)"
 * file surface (Toolbar.tsx `exportBundle`/`importBundle`). Builds
 * maximum-fidelity state on top of the seeded demo estate — one field per
 * serialised concept — exports it, wipes the workspace (Reset demo),
 * re-imports the captured file, and asserts the re-export is byte-identical
 * to the first export. That equality is the strongest oracle available: the
 * bundle's `files` map is exactly `@atlas/core`'s canonical, byte-
 * deterministic per-file JSON (packages/core/src/serialize/files.ts).
 */

interface Bundle {
  atlasBundle: number;
  files: Record<string, string>;
}

function readBundle(path: string): Bundle {
  return JSON.parse(readFileSync(path, "utf8")) as Bundle;
}

/**
 * Reads the persisted workspace bundle straight out of localStorage and
 * returns the placement row for a named element on whichever view it's on.
 * Mirrors the helper in canvas-editing.spec.ts — more precise than comparing
 * on-screen pixels, since fitView is free to change the zoom level.
 */
async function persistedPlacement(
  page: Page,
  elementName: string,
): Promise<{ x: number; y: number; width?: number; height?: number } | undefined> {
  return page.evaluate((name) => {
    const raw = localStorage.getItem("atlas.workspace.v1");
    if (!raw) return undefined;
    const files = JSON.parse(raw) as Record<string, string>;
    let elementId: string | undefined;
    for (const [path, content] of Object.entries(files)) {
      if (!path.startsWith("model/elements/")) continue;
      const el = JSON.parse(content) as { id: string; name: string };
      if (el.name === name) {
        elementId = el.id;
        break;
      }
    }
    if (!elementId) return undefined;
    for (const [path, content] of Object.entries(files)) {
      if (!path.startsWith("views/")) continue;
      const view = JSON.parse(content) as {
        placements: Array<{ elementId: string; x: number; y: number; width?: number; height?: number }>;
      };
      const placement = view.placements.find((p) => p.elementId === elementId);
      if (placement) return placement;
    }
    return undefined;
  }, elementName);
}

/** Drag a node's bottom-right NodeResizer handle by a screen-space delta. */
async function dragResizeHandle(page: Page, nodeName: string, dx: number, dy: number): Promise<void> {
  const handle = rfNode(page, nodeName).locator(".react-flow__resize-control.handle.bottom.right");
  const box = await handle.boundingBox();
  if (!box) throw new Error(`Resize handle not visible for ${nodeName}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
}

/** Field/input pairs in Inspector.tsx that have no data-testid of their own (Owners, Team). */
function labelledInput(page: Page, scope: "inspector-element", label: string) {
  return page.locator(`[data-testid="${scope}"] label`, { hasText: label }).locator("input");
}

/**
 * Select a <select data-testid="overrides-state-picker"> option by state
 * name. Once a state has an override, StateOverridesEditor decorates its
 * option label with a bullet + count (e.g. "● Target 2028 (1)"), so an exact
 * `selectOption({ label })` only works before the first override is set —
 * match by substring instead so this is safe to call at any point.
 */
async function selectOverrideState(page: Page, stateName: string): Promise<void> {
  const picker = page.getByTestId("overrides-state-picker");
  const value = await picker.locator("option", { hasText: stateName }).getAttribute("value");
  if (!value) throw new Error(`No overrides-state-picker option matched "${stateName}"`);
  await picker.selectOption(value);
}

test.describe("export → import round-trip (workspace bundle)", () => {
  test("re-exporting an imported bundle reproduces the original byte-for-byte", async ({ page }) => {
    await freshApp(page);
    await settle(page);

    // ---- Build maximum-fidelity state on top of the seeded demo estate ----

    // Element fields: colour, description, technology, status, criticality,
    // owners, team, tags (chip editor), links (links editor).
    await canvasNode(page, "CRM").click();
    await page.getByTestId("inspector-color").fill("#dc2626");
    await page.getByTestId("inspector-description").fill("Customer profiles, loyalty and support");
    await page.getByTestId("inspector-description").blur();
    await page.getByTestId("inspector-technology").fill("Salesforce, Node.js");
    await page.getByTestId("inspector-technology").blur();
    await page.getByTestId("inspector-status").selectOption("planned");
    await page.getByTestId("inspector-criticality").selectOption("high");
    await labelledInput(page, "inspector-element", "Owners").fill("Growth team, Data Platform");
    await labelledInput(page, "inspector-element", "Owners").blur();
    await labelledInput(page, "inspector-element", "Team").fill("CRM Guild");
    await labelledInput(page, "inspector-element", "Team").blur();

    await page.getByTestId("tag-input").fill("vip-customers");
    await page.getByTestId("tag-input").press("Enter");
    await page.getByTestId("tag-input").fill("priority");
    await page.getByTestId("tag-input").press(",");
    await expect(page.getByTestId("tag-chip")).toHaveCount(2);

    await page.getByTestId("link-add").click();
    await page.getByTestId("link-title").fill("Runbook");
    await page.getByTestId("link-title").blur();
    await page.getByTestId("link-url").fill("https://wiki.example.com/crm");
    await page.getByTestId("link-url").blur();

    // Temporal validity + explicit state membership.
    await page.getByTestId("temporal-from").fill("2020-01-01");
    await page.getByTestId("temporal-to").fill("2030-12-31");
    await page.getByTestId("temporal-state-Current").click();

    // Costs: one recurring, one one-off with amortiseYears + validFrom.
    await page.getByTestId("costs-toggle").click();
    await page.getByTestId("cost-add").click();
    let row = page.getByTestId("cost-row").last();
    await row.getByTestId("cost-label").fill("Support contract");
    await row.getByTestId("cost-label").blur();
    await row.getByTestId("cost-amount").fill("12000");
    await row.getByTestId("cost-amount").blur();
    await expect(row.getByTestId("cost-error")).toHaveCount(0);

    await page.getByTestId("cost-add").click();
    row = page.getByTestId("cost-row").last();
    await row.getByTestId("cost-label").fill("Migration project");
    await row.getByTestId("cost-label").blur();
    await row.getByTestId("cost-kind").selectOption("one-off");
    await row.getByTestId("cost-amortise-years").fill("4");
    await row.getByTestId("cost-amortise-years").blur();
    await row.getByTestId("cost-valid-from").fill("2026-01-01");
    await row.getByTestId("cost-amount").fill("40000");
    await row.getByTestId("cost-amount").blur();
    await expect(row.getByTestId("cost-error")).toHaveCount(0);
    await expect(page.getByTestId("costs-summary")).not.toHaveText("No costs");

    // State override, under "Target 2028".
    await page.getByTestId("overrides-toggle").click();
    await selectOverrideState(page, "Target 2028");
    await page.getByTestId("override-status").selectOption("deprecated");
    await expect(page.getByTestId("overrides-summary")).toHaveText("1 state");

    // Relationship fields: custom line colour, hidden on the active view.
    await settle(page);
    await page
      .locator(".react-flow__edge", { hasText: "takes payment via" })
      .locator(".react-flow__edge-textbg")
      .click();
    await expect(page.getByTestId("inspector-relationship")).toBeVisible();
    await page.getByTestId("inspector-rel-color").fill("#16a34a");
    await page.getByTestId("rel-hide").click();
    await expect(page.locator(".react-flow__edge", { hasText: "takes payment via" })).toHaveCount(0);

    // Pinned edge route: drag a new connection between chosen ports —
    // creates a relationship with an anchored route on this view
    // (edgeAnchors), per the pattern in routing.spec.ts.
    await connectNodes(page, "Payments", "CRM", "b2", "t2");
    await expect(page.getByTestId("reset-routing")).toContainText("b2 → t2");

    // Resized node: drag CRM's NodeResizer handle (placement width/height).
    await canvasNode(page, "CRM").click();
    const beforeResize = await rfNode(page, "CRM").boundingBox();
    if (!beforeResize) throw new Error("CRM node not visible");
    await dragResizeHandle(page, "CRM", 120, 100);
    const afterResize = await rfNode(page, "CRM").boundingBox();
    if (!afterResize) throw new Error("CRM node vanished after resize");
    expect(afterResize.width).toBeGreaterThan(beforeResize.width + 30);
    const placementBeforeExport = await persistedPlacement(page, "CRM");
    expect(placementBeforeExport?.width).toBeGreaterThan(0);
    expect(placementBeforeExport?.height).toBeGreaterThan(0);

    // ---- Export ----
    const download1Promise = page.waitForEvent("download");
    await page.getByTestId("export").click();
    await page.getByTestId("export-bundle").click();
    const download1 = await download1Promise;
    const path1 = await download1.path();
    if (!path1) throw new Error("export did not produce a file");
    const bundle1 = readBundle(path1);
    expect(bundle1.atlasBundle).toBe(1);
    expect(Object.keys(bundle1.files).length).toBeGreaterThan(0);

    // ---- Wipe (reset to the plain demo estate) and confirm the custom
    // state is actually gone, so the re-import below is a real test. ----
    page.on("dialog", (d) => d.accept());
    await page.getByTestId("reset-demo").click();
    await expect(canvasNode(page, "CRM")).toBeVisible();
    await expect(canvasNode(page, "CRM")).not.toHaveAttribute("style", /border-color: rgb\(220, 38, 38\)/);
    await canvasNode(page, "CRM").click();
    await expect(page.getByTestId("costs-summary")).toHaveText("No costs");

    // ---- Import the captured bundle ----
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByTestId("import").click();
    const chooser = await chooserPromise;
    await chooser.setFiles(path1);

    // ---- Spot-check the UI reflects every round-tripped field ----
    await expect(canvasNode(page, "CRM")).toHaveAttribute("style", /border-color: rgb\(220, 38, 38\)/);

    // Hidden relationship stays hidden on the (now active, restored) view.
    await expect(page.locator(".react-flow__edge", { hasText: "takes payment via" })).toHaveCount(0);

    // Resized node kept its size (placement data, not on-screen pixels).
    const placementAfterImport = await persistedPlacement(page, "CRM");
    expect(placementAfterImport).toEqual(placementBeforeExport);

    // Costs summary shows the round-tripped entries.
    await canvasNode(page, "CRM").click();
    await expect(page.getByTestId("costs-summary")).not.toHaveText("No costs");

    // State override applies under its state.
    await page.getByTestId("overrides-toggle").click();
    await selectOverrideState(page, "Target 2028");
    await expect(page.getByTestId("override-status")).toHaveValue("deprecated");

    // Pinned routing survived too.
    await settle(page);
    await page
      .locator(".react-flow__edge", { hasText: "uses" })
      .first()
      .locator(".react-flow__edge-textbg")
      .click();
    await expect(page.getByTestId("reset-routing")).toContainText("b2 → t2");

    // ---- Export again and diff against the first export ----
    const download2Promise = page.waitForEvent("download");
    await page.getByTestId("export").click();
    await page.getByTestId("export-bundle").click();
    const download2 = await download2Promise;
    const path2 = await download2.path();
    if (!path2) throw new Error("re-export did not produce a file");
    const bundle2 = readBundle(path2);

    // Same set of files...
    expect(Object.keys(bundle2.files).sort()).toEqual(Object.keys(bundle1.files).sort());
    // ...and byte-for-byte identical canonical content for every one of them.
    for (const [path, content] of Object.entries(bundle1.files)) {
      expect(bundle2.files[path]).toBe(content);
    }
    // Whole-payload deep-equality as a final belt-and-braces check.
    expect(bundle2).toEqual(bundle1);
  });
});
