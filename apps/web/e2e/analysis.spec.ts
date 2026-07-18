import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, treeItem } from "./helpers";

function connNode(page: import("@playwright/test").Page, name: string) {
  return page.locator(`[data-testid="connections-node"][data-elname="${name}"]`);
}

test.describe("automated views and analysis (M5)", () => {
  test("connections view shows every relationship of an element across the estate", async ({ page }) => {
    await freshApp(page);
    // Web App is only placed on the container view, but its connections are estate-wide.
    await treeItem(page, "Booking Engine").click();
    await page.getByTestId("open-connections").click();

    await expect(page.getByTestId("connections-view")).toBeVisible();
    // 1 hop: Customer (in), Payments (out), CRM (out) — regardless of diagrams.
    await expect(connNode(page, "Booking Engine")).toBeVisible();
    await expect(connNode(page, "Customer")).toBeVisible();
    await expect(connNode(page, "Payments")).toBeVisible();
    await expect(connNode(page, "CRM")).toBeVisible();
    // Containers are not related directly, so they are absent at depth 1.
    await expect(connNode(page, "Web App")).toHaveCount(0);
  });

  test("direction and depth filters re-run the graph query", async ({ page }) => {
    await freshApp(page);
    await treeItem(page, "Customer").click();
    await page.getByTestId("open-connections").click();

    // Depth 1 outgoing from Customer: only Booking Engine.
    await page.getByTestId("connections-direction").selectOption("out");
    await expect(connNode(page, "Booking Engine")).toBeVisible();
    await expect(connNode(page, "Payments")).toHaveCount(0);

    // Depth 2 outgoing reaches Payments and CRM through Booking Engine.
    await page.getByTestId("connections-depth").selectOption("2");
    await expect(connNode(page, "Payments")).toBeVisible();
    await expect(connNode(page, "CRM")).toBeVisible();

    // Incoming to Customer: nothing.
    await page.getByTestId("connections-direction").selectOption("in");
    await expect(connNode(page, "Payments")).toHaveCount(0);
    await expect(connNode(page, "Booking Engine")).toHaveCount(0);

    await page.getByTestId("connections-close").click();
    await expect(page.getByTestId("connections-view")).toHaveCount(0);
  });

  test("analysis drawer reports orphans and duplicate names, and clears when fixed", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("open-analysis").click();
    await expect(page.getByTestId("analysis-drawer")).toBeVisible();
    // Seed estate is fully placed and uniquely named.
    await expect(page.getByTestId("lint-clean")).toBeVisible();
    await page.getByTestId("analysis-close").click();

    // Create an orphan: add a system, then remove it from the view.
    await page.getByTestId("palette-system").click();
    await page.getByTestId("remove-from-view").click();

    await page.getByTestId("open-analysis").click();
    await expect(page.getByTestId("lint-issues")).toContainText("orphan-element");
    await expect(page.getByTestId("lint-issues")).toContainText("New Software System");
  });

  test("dependency matrix counts system-to-system relationships", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("open-analysis").click();
    const matrix = page.getByTestId("dependency-matrix");
    await expect(matrix).toBeVisible();
    // Booking Engine row has outgoing deps to Payments and CRM (two non-empty cells).
    await expect(matrix.locator("td.bg-blue-100")).toHaveCount(3); // customer→booking, booking→payments, booking→crm
  });

  test("impact traversal lists everything downstream", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("open-analysis").click();
    await page.getByTestId("impact-select").selectOption({ label: "Customer" });
    const list = page.getByTestId("impact-list");
    await expect(list).toContainText("Booking Engine");
    await expect(list).toContainText("Payments");
    await expect(list).toContainText("CRM");
  });

  test("selecting a node in the connections view drives the inspector", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Booking Engine").click();
    await page.getByTestId("open-connections").click();
    await connNode(page, "Payments").click();
    await page.getByTestId("connections-close").click();
    await expect(page.getByTestId("inspector-name")).toHaveValue("Payments");
  });
});
