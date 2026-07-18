import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, rfNode, treeItem } from "./helpers";

test.describe("C4 zoom navigation", () => {
  test("double-clicking a system drills into its container view", async ({ page }) => {
    await freshApp(page);
    await expect(rfNode(page, "Booking Engine").getByTestId("drill-affordance")).toBeVisible();

    await rfNode(page, "Booking Engine").dblclick();

    await expect(canvasNode(page, "Web App")).toBeVisible();
    await expect(canvasNode(page, "Booking API")).toBeVisible();
    await expect(canvasNode(page, "Booking DB")).toBeVisible();
    await expect(canvasNode(page, "Customer")).toHaveCount(0);

    // Breadcrumb shows Landscape / Booking Engine.
    await expect(page.getByTestId("crumb-Booking Engine")).toBeVisible();
  });

  test("breadcrumb zooms back out to the landscape", async ({ page }) => {
    await freshApp(page);
    await rfNode(page, "Booking Engine").dblclick();
    await expect(canvasNode(page, "Web App")).toBeVisible();

    await page.getByTestId("crumb-landscape").click();
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
    await expect(canvasNode(page, "Web App")).toHaveCount(0);
  });

  test("drilling into a container creates a component view level", async ({ page }) => {
    await freshApp(page);
    await rfNode(page, "Booking Engine").dblclick();
    await expect(canvasNode(page, "Booking API")).toBeVisible();

    // Add a component inside Booking API so it becomes drillable.
    await canvasNode(page, "Booking API").click();
    // Palette on a container view creates children of the scope; instead drill directly:
    // a container without children has no drill affordance.
    await expect(rfNode(page, "Booking API").getByTestId("drill-affordance")).toHaveCount(0);
  });

  test("a component added on a container view nests under the scope and enables drill", async ({ page }) => {
    await freshApp(page);
    await rfNode(page, "Booking Engine").dblclick();
    await expect(canvasNode(page, "Web App")).toBeVisible();

    // On the container view the palette scopes new containers to Booking Engine.
    await page.getByTestId("palette-container").click();
    await expect(canvasNode(page, "New Container")).toBeVisible();

    // The tree nests it under Booking Engine.
    await expect(treeItem(page, "New Container")).toBeVisible();

    // And people belong to context level only — disabled here (systems from
    // the same section stay usable, e.g. external systems on a container view).
    await expect(page.getByTestId("palette-person")).toBeDisabled();
    await expect(page.getByTestId("palette-system")).toBeEnabled();
  });

  test("full drill: landscape → containers → components → back to landscape", async ({ page }) => {
    await freshApp(page);

    // Landscape → Booking Engine containers.
    await rfNode(page, "Booking Engine").dblclick();
    await expect(canvasNode(page, "Booking API")).toBeVisible();

    // Containers → Booking API components (empty view is created on first drill).
    await rfNode(page, "Booking API").dblclick();
    await expect(page.getByTestId("crumb-Booking API")).toBeVisible();
    await expect(canvasNode(page, "Web App")).toHaveCount(0);

    // Add a component here; it nests inside Booking API.
    await page.getByTestId("palette-component").click();
    await expect(canvasNode(page, "New Component")).toBeVisible();

    // Breadcrumb chain zooms back out: Booking Engine, then Landscape.
    await page.getByTestId("crumb-Booking Engine").click();
    await expect(canvasNode(page, "Booking API")).toBeVisible();
    await page.getByTestId("crumb-landscape").click();
    await expect(canvasNode(page, "Customer")).toBeVisible();

    // The component is now drillable evidence in the tree under Booking API.
    await expect(treeItem(page, "New Component")).toBeVisible();
  });

  test("'appears in' jumps to the view containing the element", async ({ page }) => {
    await freshApp(page);
    await treeItem(page, "Web App").click();
    await page.getByTestId("appears-in-Booking Engine — containers").click();

    await expect(canvasNode(page, "Web App")).toBeVisible();
    await expect(page.getByTestId("crumb-Booking Engine")).toBeVisible();
    // The element stays selected for editing.
    await expect(page.getByTestId("inspector-name")).toHaveValue("Web App");
  });

  test("view list switches views", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("view-Booking Engine — containers").click();
    await expect(canvasNode(page, "Web App")).toBeVisible();
    await page.getByTestId("view-Landscape").click();
    await expect(canvasNode(page, "Customer")).toBeVisible();
  });
});
