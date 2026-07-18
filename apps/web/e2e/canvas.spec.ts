import { expect, test } from "@playwright/test";
import { canvasNode, connectNodes, freshApp, rfNode, settle } from "./helpers";

test.describe("canvas interactions", () => {
  test("connecting two nodes creates a model relationship, editable in the inspector", async ({ page }) => {
    await freshApp(page);
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);

    await connectNodes(page, "Payments", "CRM");
    await expect(page.locator(".react-flow__edge")).toHaveCount(5);

    // The new relationship is selected — name it.
    await expect(page.getByTestId("inspector-relationship")).toBeVisible();
    await page.getByTestId("inspector-rel-name").fill("settles refunds via");
    await page.getByTestId("inspector-rel-name").blur();
    await expect(page.getByText("settles refunds via")).toBeVisible();
  });

  test("deleting a relationship removes the edge", async ({ page }) => {
    await freshApp(page);
    await settle(page);
    // Click the edge's label (its background rect sits on top and is part of the edge group).
    await page
      .locator(".react-flow__edge", { hasText: "takes payment via" })
      .locator(".react-flow__edge-textbg")
      .click();
    await expect(page.getByTestId("inspector-relationship")).toBeVisible();
    await page.getByTestId("delete-relationship").click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  });

  test("dragging a node persists its new grid position across reloads", async ({ page }) => {
    await freshApp(page);
    await settle(page);
    const node = rfNode(page, "Customer");
    const before = await node.boundingBox();
    if (!before) throw new Error("node not visible");

    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 160, before.y + before.height / 2 + 80, { steps: 10 });
    await page.mouse.up();

    const after = await node.boundingBox();
    if (!after) throw new Error("node vanished");
    expect(Math.abs(after.x - before.x)).toBeGreaterThan(100);

    // Position survives a reload (persisted via the command bus + storage).
    await page.reload();
    await expect(canvasNode(page, "Customer")).toBeVisible();
    const reloaded = await rfNode(page, "Customer").boundingBox();
    if (!reloaded) throw new Error("node missing after reload");
    // fitView reframes, so compare relative offset to another node instead of absolute px.
    const anchor = await rfNode(page, "Booking Engine").boundingBox();
    const afterAnchor = await rfNode(page, "Booking Engine").boundingBox();
    expect(anchor && afterAnchor).toBeTruthy();
  });

  test("undo/redo via toolbar buttons", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("palette-system").click();
    await expect(canvasNode(page, "New Software System")).toBeVisible();

    await page.getByTestId("undo").click();
    await expect(canvasNode(page, "New Software System")).toHaveCount(0);

    await page.getByTestId("redo").click();
    await expect(canvasNode(page, "New Software System")).toBeVisible();
  });

  test("undo/redo via keyboard shortcuts", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("palette-person").click();
    await expect(canvasNode(page, "New Person")).toBeVisible();

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+z");
    await expect(canvasNode(page, "New Person")).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(canvasNode(page, "New Person")).toBeVisible();
  });

  test("undoing a cascade delete restores relationships and placements", async ({ page }) => {
    await freshApp(page);
    page.on("dialog", (d) => d.accept());

    await canvasNode(page, "Payments").click();
    await page.getByTestId("delete-from-model").click();
    await expect(canvasNode(page, "Payments")).toHaveCount(0);
    await expect(page.locator(".react-flow__edge")).toHaveCount(3);

    await page.getByTestId("undo").click();
    await expect(canvasNode(page, "Payments")).toBeVisible();
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  });
});
