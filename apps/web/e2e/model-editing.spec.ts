import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, treeItem } from "./helpers";

test.describe("model editing via palette and inspector", () => {
  test("adds a system from the palette; it appears on canvas, tree, and inspector", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("palette-system").click();

    await expect(canvasNode(page, "New Software System")).toBeVisible();
    await expect(treeItem(page, "New Software System")).toBeVisible();
    await expect(page.getByTestId("inspector-name")).toHaveValue("New Software System");
  });

  test("renaming an element updates it everywhere (canvas, tree, breadcrumb targets)", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await page.getByTestId("inspector-name").fill("Payments Hub");
    await page.getByTestId("inspector-name").press("Enter");

    await expect(canvasNode(page, "Payments Hub")).toBeVisible();
    await expect(treeItem(page, "Payments Hub")).toBeVisible();
    await expect(canvasNode(page, "Payments")).toHaveCount(0);
  });

  test("edits made in one view are visible in another view (single model)", async ({ page }) => {
    await freshApp(page);
    // Rename Web App from the landscape's model tree (it is only placed on the container view).
    await treeItem(page, "Web App").click();
    await page.getByTestId("inspector-name").fill("Customer Web");
    await page.getByTestId("inspector-name").press("Enter");

    // Navigate to the container view and confirm the rename is there.
    await page.getByTestId("view-Booking Engine — containers").click();
    await expect(canvasNode(page, "Customer Web")).toBeVisible();
    await expect(canvasNode(page, "Web App")).toHaveCount(0);
  });

  test("technology, status and tags editing round-trips through the inspector", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "CRM").click();

    await page.getByTestId("inspector-technology").fill("Salesforce, MuleSoft");
    await page.getByTestId("inspector-technology").blur();
    await page.getByTestId("inspector-status").selectOption("deprecated");
    await page.getByTestId("inspector-tags").fill("legacy, saas");
    await page.getByTestId("inspector-tags").blur();

    // Technology shows on the node subtitle.
    await expect(canvasNode(page, "CRM")).toContainText("Salesforce, MuleSoft");

    // Values survive reselection (reading back from the model).
    await canvasNode(page, "Payments").click();
    await canvasNode(page, "CRM").click();
    await expect(page.getByTestId("inspector-technology")).toHaveValue("Salesforce, MuleSoft");
    await expect(page.getByTestId("inspector-status")).toHaveValue("deprecated");
    await expect(page.getByTestId("inspector-tags")).toHaveValue("legacy, saas");
  });

  test("markdown documentation renders in the preview tab", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Booking Engine").click();
    await page.getByTestId("doc-tab-preview").click();
    await expect(page.getByTestId("doc-preview").locator("h2")).toHaveText("Booking Engine");
    await expect(page.getByTestId("doc-preview").locator("strong")).toHaveText("system of record");
  });

  test("removing from a view keeps the element in the model; deleting removes it entirely", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "CRM").click();

    // Remove from view: gone from canvas, still in the tree (flagged as orphan).
    await page.getByTestId("remove-from-view").click();
    await expect(canvasNode(page, "CRM")).toHaveCount(0);
    await expect(treeItem(page, "CRM")).toBeVisible();

    // Delete from model (confirm dialog): gone from the tree too.
    page.on("dialog", (d) => d.accept());
    await treeItem(page, "CRM").click();
    await page.getByTestId("delete-from-model").click();
    await expect(treeItem(page, "CRM")).toHaveCount(0);
  });

  test("deleting a system with children is refused with a clear error", async ({ page }) => {
    await freshApp(page);
    page.on("dialog", (d) => d.accept());
    await canvasNode(page, "Booking Engine").click();
    await page.getByTestId("delete-from-model").click();

    await expect(page.getByTestId("toast-error")).toContainText("still contains");
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
  });

  test("level rules: container/component stencils are disabled on the landscape", async ({ page }) => {
    await freshApp(page);
    // The palette is organised by level; wrong-level stencils are greyed out.
    await expect(page.getByTestId("palette-level-context")).toBeVisible();
    await expect(page.getByTestId("palette-level-container-unavailable")).toBeVisible();
    await expect(page.getByTestId("palette-container")).toBeDisabled();
    await expect(page.getByTestId("palette-component")).toBeDisabled();
    await expect(page.getByTestId("palette-system")).toBeEnabled();
    await expect(canvasNode(page, "New Container")).toHaveCount(0);
  });

  test("placing an existing model element onto the current view from the tree", async ({ page }) => {
    await freshApp(page);
    // Remove CRM from the landscape, then place it back from the tree.
    await canvasNode(page, "CRM").click();
    await page.getByTestId("remove-from-view").click();
    await expect(canvasNode(page, "CRM")).toHaveCount(0);

    await treeItem(page, "CRM").hover();
    await page.getByTestId("place-CRM").click();
    await expect(canvasNode(page, "CRM")).toBeVisible();
  });
});
