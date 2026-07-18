import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, treeItem } from "./helpers";

test.describe("app shell", () => {
  test("loads the demo estate with all panels", async ({ page }) => {
    await freshApp(page);

    // Toolbar
    await expect(page.getByTestId("workspace-name")).toHaveText("Demo estate");
    await expect(page.getByTestId("undo")).toBeVisible();

    // Palette lists the C4 core stencils
    for (const kind of ["person", "system", "container", "component", "group"]) {
      await expect(page.getByTestId(`palette-${kind}`)).toBeVisible();
    }

    // Landscape canvas shows the seeded systems
    for (const name of ["Customer", "Booking Engine", "Payments", "CRM"]) {
      await expect(canvasNode(page, name)).toBeVisible();
    }

    // Model tree shows hierarchy incl. containers not on this view
    await expect(treeItem(page, "Booking Engine")).toBeVisible();
    await expect(treeItem(page, "Web App")).toBeVisible();

    // Inspector empty state
    await expect(page.getByTestId("inspector-empty")).toBeVisible();

    // Breadcrumbs show the landscape
    await expect(page.getByTestId("crumb-landscape")).toBeVisible();
  });

  test("edges from the model render on the canvas with labels", async ({ page }) => {
    await freshApp(page);
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);
    await expect(page.getByText("books trips using")).toBeVisible();
  });
});
