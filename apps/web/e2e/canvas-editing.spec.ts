import { expect, test, type Page } from "@playwright/test";
import { canvasNode, freshApp, rfNode, settle, treeItem } from "./helpers";

/**
 * Reads the persisted workspace bundle straight out of localStorage (the
 * same `atlas.workspace.v1` files map the store round-trips through) and
 * returns the placement row for a named element on whichever view it's on.
 * This is a more precise check than comparing on-screen pixels after a
 * reload, since fitView is free to change the zoom level.
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

test.describe("canvas editing", () => {
  test("resizing a selected element node persists, survives reload, and undoes in one step", async ({ page }) => {
    await freshApp(page);
    await settle(page);

    await canvasNode(page, "CRM").click();
    const handle = rfNode(page, "CRM").locator(".react-flow__resize-control.handle.bottom.right");
    await expect(handle).toBeVisible();

    const before = await rfNode(page, "CRM").boundingBox();
    if (!before) throw new Error("CRM node not visible");

    await dragResizeHandle(page, "CRM", 120, 100);

    const after = await rfNode(page, "CRM").boundingBox();
    if (!after) throw new Error("CRM node vanished");
    expect(after.width).toBeGreaterThan(before.width + 30);
    expect(after.height).toBeGreaterThan(before.height + 30);

    const placement = await persistedPlacement(page, "CRM");
    expect(placement?.width).toBeGreaterThan(0);
    expect(placement?.height).toBeGreaterThan(0);

    // A single undo reverts the resize — the placement loses width/height.
    // (Undo history is in-memory, so this has to happen before the reload.)
    await page.getByTestId("undo").click();
    const afterUndo = await persistedPlacement(page, "CRM");
    expect(afterUndo?.width).toBeUndefined();
    expect(afterUndo?.height).toBeUndefined();

    // Redo the resize, then reload: the new size round-trips through the
    // persisted bundle.
    await page.getByTestId("redo").click();
    const redone = await persistedPlacement(page, "CRM");
    expect(redone).toEqual(placement);

    await page.reload();
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
    const reloadedPlacement = await persistedPlacement(page, "CRM");
    expect(reloadedPlacement).toEqual(placement);
  });

  test("resizing a selected group node persists and undoes in one step", async ({ page }) => {
    await freshApp(page);
    await settle(page);

    await page.getByTestId("palette-group").click();
    const groupName = "New Group / Boundary";
    await expect(canvasNode(page, groupName)).toBeVisible();
    // The palette's freeSpot search plants new nodes well away from the
    // existing estate, often outside the current viewport — reframe before
    // measuring or dragging anything.
    await page.locator(".react-flow__controls-fitview").click();
    await settle(page);

    const handle = rfNode(page, groupName).locator(".react-flow__resize-control.handle.bottom.right");
    await expect(handle).toBeVisible();

    const before = await rfNode(page, groupName).boundingBox();
    if (!before) throw new Error("group node not visible");

    await dragResizeHandle(page, groupName, 150, 120);

    const after = await rfNode(page, groupName).boundingBox();
    if (!after) throw new Error("group node vanished");
    expect(after.width).toBeGreaterThan(before.width + 30);
    expect(after.height).toBeGreaterThan(before.height + 30);

    const placement = await persistedPlacement(page, groupName);
    expect(placement?.width).toBeGreaterThan(0);
    expect(placement?.height).toBeGreaterThan(0);

    // Single undo: first reverts the resize (placement loses width/height),
    // a second reverts the group's creation entirely.
    await page.getByTestId("undo").click();
    const afterUndo = await persistedPlacement(page, groupName);
    expect(afterUndo?.width).toBeUndefined();
    expect(afterUndo?.height).toBeUndefined();
  });

  test("dragging an element into a group re-parents it, with a drop highlight mid-drag; dragging out un-nests; undo restores", async ({
    page,
  }) => {
    await freshApp(page);
    await settle(page);

    // No group in the seeded demo estate — create one via the palette first.
    await page.getByTestId("palette-group").click();
    const groupName = "New Group / Boundary";
    await expect(canvasNode(page, groupName)).toBeVisible();
    // The palette's freeSpot search plants new nodes well away from the
    // existing estate, often outside the current viewport — reframe before
    // measuring or dragging anything.
    await page.locator(".react-flow__controls-fitview").click();
    await settle(page);

    const originalPaymentsBox = await rfNode(page, "Payments").boundingBox();
    const groupBox = await rfNode(page, groupName).boundingBox();
    if (!originalPaymentsBox || !groupBox) throw new Error("nodes not visible");

    // Top-level to start with.
    await expect(treeItem(page, "Payments")).toHaveCSS("padding-left", "6px");

    // Drag Payments' centre into the group's bounds.
    await page.mouse.move(
      originalPaymentsBox.x + originalPaymentsBox.width / 2,
      originalPaymentsBox.y + originalPaymentsBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(groupBox.x + groupBox.width / 2, groupBox.y + groupBox.height / 2, { steps: 15 });
    await expect(canvasNode(page, groupName)).toHaveAttribute("data-drop-highlight", "true");
    await page.mouse.up();

    // Highlight clears once the drag ends, and the element is now nested
    // one level deeper in the model tree.
    await expect(canvasNode(page, groupName)).not.toHaveAttribute("data-drop-highlight");
    await expect(treeItem(page, "Payments")).toHaveCSS("padding-left", "20px");

    // Deselect the group — React Flow's elevateNodesOnSelect otherwise
    // keeps the still-selected group's DOM node stacked above whatever is
    // nested inside it, which would steal the next drag's mousedown. Wait
    // for the "selected" class to actually drop off before continuing.
    const nestedBox = await rfNode(page, "Payments").boundingBox();
    if (!nestedBox) throw new Error("Payments not visible after nesting");
    await page.keyboard.press("Escape");
    await expect(rfNode(page, groupName)).not.toHaveClass(/selected/);

    // Drag it back out, dropping it where it originally sat (well outside
    // the group's bounds).
    await page.mouse.move(nestedBox.x + nestedBox.width / 2, nestedBox.y + nestedBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      originalPaymentsBox.x + originalPaymentsBox.width / 2,
      originalPaymentsBox.y + originalPaymentsBox.height / 2,
      { steps: 15 },
    );
    await page.mouse.up();

    // Regression guard: `updateElement({ parentId: null })` must mean
    // "explicitly top-level", not "delete the key" — a delete leaves
    // `parentId` undefined and the element vanishes from the Model tree
    // (`Workspace.children()` matches with a strict `=== null`).
    await expect(treeItem(page, "Payments")).toHaveCSS("padding-left", "6px");
    await expect(canvasNode(page, "Payments")).toBeVisible();

    await page.getByTestId("undo").click();
    await expect(treeItem(page, "Payments")).toHaveCSS("padding-left", "20px");
  });

  test("dragging a node onto a non-group node is a no-op for parentage", async ({ page }) => {
    await freshApp(page);
    await settle(page);

    await expect(treeItem(page, "CRM")).toHaveCSS("padding-left", "6px");

    const crmBox = await rfNode(page, "CRM").boundingBox();
    const paymentsBox = await rfNode(page, "Payments").boundingBox();
    if (!crmBox || !paymentsBox) throw new Error("nodes not visible");

    await page.mouse.move(crmBox.x + crmBox.width / 2, crmBox.y + crmBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(paymentsBox.x + paymentsBox.width / 2, paymentsBox.y + paymentsBox.height / 2, {
      steps: 15,
    });
    await page.mouse.up();

    // CRM moved, but Payments is not a group, so nothing re-parented.
    await expect(treeItem(page, "CRM")).toHaveCSS("padding-left", "6px");
  });
});
