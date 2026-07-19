import { expect, test, type Page } from "@playwright/test";
import { canvasNode, freshApp, treeItem } from "./helpers";

/**
 * A valid, empty Atlas workspace bundle in the same `atlas.workspace.v1`
 * localStorage shape the store persists (see apps/web/src/store.ts). The
 * placeholder view is deliberately not a "landscape" view so it doesn't
 * collide with the "Landscape" view the demo model itself creates.
 */
const EMPTY_WORKSPACE_FILES: Record<string, string> = {
  "atlas.workspace.json": JSON.stringify({ formatVersion: 1, name: "Empty workspace" }),
  "views/01ARZ3NDEKTSV4RRFFQ69G5FAV.json": JSON.stringify({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    kind: "custom",
    name: "Untitled",
    scopeId: null,
    placements: [],
  }),
};

/** Load the app with an empty workspace (no elements) already persisted. */
async function emptyApp(page: Page): Promise<void> {
  await page.addInitScript((files) => {
    localStorage.setItem("atlas.workspace.v1", JSON.stringify(files));
  }, EMPTY_WORKSPACE_FILES);
  await page.goto("/");
  await expect(page.getByTestId("canvas")).toBeVisible();
}

test.describe("help panel", () => {
  test("opens, lists every section, and expands/collapses one", async ({ page }) => {
    await freshApp(page);

    await expect(page.getByTestId("help-panel")).toHaveCount(0);
    await page.getByTestId("help-open").click();
    await expect(page.getByTestId("help-panel")).toBeVisible();

    const sections = page.getByTestId("help-section");
    await expect(sections).toHaveCount(10);
    await expect(page.getByText("Getting started")).toBeVisible();
    await expect(page.getByText("Keyboard shortcuts")).toBeVisible();

    // "Costs & TCO" starts collapsed — its body is not in the DOM.
    await expect(page.getByText("Add cost entries from the Inspector's collapsible")).toHaveCount(0);
    await page.getByTestId("help-section-toggle-costs").click();
    await expect(page.getByText(/Add cost entries from the Inspector/)).toBeVisible();
    await page.getByTestId("help-section-toggle-costs").click();
    await expect(page.getByText(/Add cost entries from the Inspector/)).toHaveCount(0);

    // The API docs link (in "Saving & sharing") is a plain, real anchor.
    await page.getByTestId("help-section-toggle-saving").click();
    const apiLink = page.getByRole("link", { name: "/api/docs" });
    await expect(apiLink).toHaveAttribute("href", "/api/docs");
    await expect(apiLink).toHaveAttribute("target", "_blank");
  });

  test("closes via help-close, and help-open re-opens it", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("help-open").click();
    await expect(page.getByTestId("help-panel")).toBeVisible();

    await page.getByTestId("help-close").click();
    await expect(page.getByTestId("help-panel")).toHaveCount(0);

    await page.getByTestId("help-open").click();
    await expect(page.getByTestId("help-panel")).toBeVisible();
  });

  test("load demo model is disabled with an explanation once the workspace has elements", async ({ page }) => {
    await freshApp(page); // seeded demo estate already has elements
    await page.getByTestId("help-open").click();

    const loadDemo = page.getByTestId("help-load-demo");
    await expect(loadDemo).toBeVisible();
    await expect(loadDemo).toBeDisabled();
    await expect(loadDemo).toHaveAttribute("title", /empty workspace/i);
  });

  test("load demo model builds the worked example, populates the tree, undoes as one step, and closes the panel", async ({
    page,
  }) => {
    await emptyApp(page);
    await expect(canvasNode(page, "Booking Engine")).toHaveCount(0);

    await page.getByTestId("help-open").click();
    const loadDemo = page.getByTestId("help-load-demo");
    await expect(loadDemo).toBeEnabled();
    await loadDemo.click();

    // Panel closes automatically once the demo has loaded.
    await expect(page.getByTestId("help-panel")).toHaveCount(0);

    // Nodes appear on the canvas (landscape view).
    await expect(canvasNode(page, "Passenger")).toBeVisible();
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
    await expect(canvasNode(page, "Payments")).toBeVisible();

    // Model tree includes the costed container even though it isn't placed
    // on the landscape view.
    await expect(treeItem(page, "Payments API")).toBeVisible();

    // Named states from the demo are selectable on the timeline bar.
    await expect(page.getByTestId("time-state-Current")).toBeVisible();
    await expect(page.getByTestId("time-state-Target 2028")).toBeVisible();

    // A single undo removes the whole batch — back to nothing.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvasNode(page, "Passenger")).toHaveCount(0);
    await expect(canvasNode(page, "Booking Engine")).toHaveCount(0);
    await expect(page.getByTestId("time-state-Current")).toHaveCount(0);

    // help-open still works after all this.
    await page.getByTestId("help-open").click();
    await expect(page.getByTestId("help-panel")).toBeVisible();
    await expect(page.getByTestId("help-load-demo")).toBeEnabled();
  });
});
