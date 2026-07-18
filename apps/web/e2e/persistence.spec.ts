import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, treeItem } from "./helpers";

test.describe("persistence and workspace lifecycle", () => {
  test("model changes survive a page reload", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("palette-system").click();
    await canvasNode(page, "New Software System").click();
    await page.getByTestId("inspector-name").fill("Data Platform");
    await page.getByTestId("inspector-name").press("Enter");
    await expect(canvasNode(page, "Data Platform")).toBeVisible();

    await page.reload();
    await expect(canvasNode(page, "Data Platform")).toBeVisible();
    await expect(treeItem(page, "Data Platform")).toBeVisible();
  });

  test("reset demo restores the seed estate", async ({ page }) => {
    await freshApp(page);
    page.on("dialog", (d) => d.accept());
    await page.getByTestId("palette-system").click();
    await expect(canvasNode(page, "New Software System")).toBeVisible();

    await page.getByTestId("reset-demo").click();
    await expect(canvasNode(page, "New Software System")).toHaveCount(0);
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
  });

  test("export downloads a bundle; import restores it", async ({ page }) => {
    await freshApp(page);

    // Make a distinctive change, then export.
    await canvasNode(page, "CRM").click();
    await page.getByTestId("inspector-name").fill("Loyalty Platform");
    await page.getByTestId("inspector-name").press("Enter");

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export").click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(download.suggestedFilename()).toContain(".atlas.json");

    // Wipe back to demo, then import the bundle.
    page.on("dialog", (d) => d.accept());
    await page.getByTestId("reset-demo").click();
    await expect(canvasNode(page, "CRM")).toBeVisible();

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByTestId("import").click();
    const chooser = await chooserPromise;
    await chooser.setFiles(path!);

    await expect(canvasNode(page, "Loyalty Platform")).toBeVisible();
    await expect(canvasNode(page, "CRM")).toHaveCount(0);
  });

  test("a corrupt persisted workspace falls back to the demo instead of crashing", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("atlas.workspace.v1", "{not json");
    });
    await page.goto("/");
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
  });
});
