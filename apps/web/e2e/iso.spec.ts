import { expect, test } from "@playwright/test";
import { canvasNode, freshApp } from "./helpers";

function isoNode(page: import("@playwright/test").Page, name: string) {
  return page.locator(`[data-testid="iso-node"][data-elname="${name}"]`);
}

test.describe("isometric mode", () => {
  test("toggling iso renders the same elements with no re-layout", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("mode-iso").click();

    await expect(page.getByTestId("iso-canvas")).toBeVisible();
    for (const name of ["Customer", "Booking Engine", "Payments", "CRM"]) {
      await expect(isoNode(page, name)).toBeVisible();
    }
    // All model relationships between placed elements are drawn.
    await expect(page.getByTestId("iso-edge")).toHaveCount(4);

    // Same scene graph: relative left-to-right order is preserved under projection
    // (Customer is left of Booking Engine in grid coordinates).
    const customer = await isoNode(page, "Customer").boundingBox();
    const booking = await isoNode(page, "Booking Engine").boundingBox();
    expect(customer && booking && customer.x < booking.x).toBe(true);
  });

  test("selection works in iso and drives the shared inspector", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("mode-iso").click();

    await isoNode(page, "Payments").click();
    await expect(page.getByTestId("inspector-name")).toHaveValue("Payments");

    // Rename from the inspector; the iso label updates (same model object).
    await page.getByTestId("inspector-name").fill("Payments Hub");
    await page.getByTestId("inspector-name").press("Enter");
    await expect(isoNode(page, "Payments Hub")).toBeVisible();
  });

  test("render mode is per-view state and persists across reloads", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("mode-iso").click();
    await expect(page.getByTestId("iso-canvas")).toBeVisible();

    // Switching view goes back to that view's own mode (2D).
    await page.getByTestId("view-Booking Engine — containers").click();
    await expect(page.getByTestId("iso-canvas")).toHaveCount(0);
    await expect(canvasNode(page, "Web App")).toBeVisible();

    // Landscape remembers iso — including after a reload (persisted via updateView).
    await page.getByTestId("view-Landscape").click();
    await expect(page.getByTestId("iso-canvas")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("iso-canvas")).toBeVisible();

    // Back to 2D.
    await page.getByTestId("mode-2d").click();
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
  });

  test("iso mode toggle is undoable like any other command", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("mode-iso").click();
    await expect(page.getByTestId("iso-canvas")).toBeVisible();
    await page.getByTestId("undo").click();
    await expect(page.getByTestId("iso-canvas")).toHaveCount(0);
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
  });
});
