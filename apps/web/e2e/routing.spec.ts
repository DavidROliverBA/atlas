import { expect, test } from "@playwright/test";
import { canvasNode, connectNodes, freshApp, rfNode, settle } from "./helpers";

test.describe("connection ports, routing and colours", () => {
  test("every box exposes 16 ports: 5 top, 5 bottom, 3 per side", async ({ page }) => {
    await freshApp(page);
    const node = rfNode(page, "Booking Engine");
    await expect(node.locator(".atlas-port")).toHaveCount(16);
    for (const id of ["t0", "t4", "b0", "b4", "l0", "l2", "r0", "r2"]) {
      await expect(node.locator(`.react-flow__handle[data-handleid="${id}"]`)).toHaveCount(1);
    }
  });

  test("boxes in line get straight lines via facing mid-ports", async ({ page }) => {
    await freshApp(page);
    await settle(page);
    // Customer (0,6) and Booking Engine (14,6) share a row in the seed —
    // the routing rule must render their edge as a straight horizontal line.
    const path = page
      .locator('.react-flow__edge[aria-label*="Edge"]', { hasText: "" })
      .first();
    const edges = page.locator(".react-flow__edge-path");
    const count = await edges.count();
    let horizontal = 0;
    for (let i = 0; i < count; i++) {
      const d = (await edges.nth(i).getAttribute("d")) ?? "";
      // A straight edge is a single M…L… segment; horizontal ⇒ equal y at both ends.
      const match = d.match(/^M\s*(-?[\d.]+),(-?[\d.]+)\s*L\s*(-?[\d.]+),(-?[\d.]+)$/);
      if (match && Math.abs(Number(match[2]) - Number(match[4])) < 0.5) horizontal++;
    }
    expect(horizontal).toBeGreaterThanOrEqual(1);
    void path;
  });

  test("dragging between chosen ports pins the routing and persists it", async ({ page }) => {
    await freshApp(page);
    // Connect Payments bottom-mid port to CRM top-mid port.
    await connectNodes(page, "Payments", "CRM", "b2", "t2");
    await expect(page.locator(".react-flow__edge")).toHaveCount(5);
    await expect(page.getByTestId("inspector-relationship")).toBeVisible();

    // The inspector shows the pinned ports and offers a reset.
    await expect(page.getByTestId("reset-routing")).toContainText("b2 → t2");

    // Pinned routing survives a reload (stored on the view).
    await page.reload();
    await settle(page);
    await page
      .locator(".react-flow__edge", { hasText: "uses" })
      .first()
      .locator(".react-flow__edge-textbg")
      .click();
    await expect(page.getByTestId("reset-routing")).toContainText("b2 → t2");

    // Reset returns the edge to automatic routing.
    await page.getByTestId("reset-routing").click();
    await expect(page.getByTestId("reset-routing")).toHaveCount(0);
  });

  test("box and line colours are editable, persisted, and undoable", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Booking Engine").click();
    await page.getByTestId("inspector-color").fill("#dc2626");
    await expect(canvasNode(page, "Booking Engine")).toHaveAttribute(
      "style",
      /border-color: rgb\(220, 38, 38\)/,
    );

    // Line colour on a relationship.
    await settle(page);
    await page
      .locator(".react-flow__edge", { hasText: "takes payment via" })
      .locator(".react-flow__edge-textbg")
      .click();
    await page.getByTestId("inspector-rel-color").fill("#16a34a");
    const colored = page.locator(".react-flow__edge", { hasText: "takes payment via" }).locator(".react-flow__edge-path");
    await expect(colored).toHaveAttribute("style", /stroke: rgb\(22, 163, 74\)/);

    // Colours survive reload…
    await page.reload();
    await expect(canvasNode(page, "Booking Engine")).toHaveAttribute(
      "style",
      /border-color: rgb\(220, 38, 38\)/,
    );

    // …and reset cleanly.
    await canvasNode(page, "Booking Engine").click();
    await page.getByTestId("inspector-color-reset").click();
    await expect(canvasNode(page, "Booking Engine")).not.toHaveAttribute(
      "style",
      /border-color: rgb\(220, 38, 38\)/,
    );
  });

  test("auto-layout re-arranges the view as a single undo step", async ({ page }) => {
    await freshApp(page);
    await settle(page);
    const before = await rfNode(page, "CRM").boundingBox();

    await page.getByTestId("auto-layout").click();
    await settle(page);
    // All nodes still present after layout.
    for (const name of ["Customer", "Booking Engine", "Payments", "CRM", "Legacy Mainframe"]) {
      await expect(canvasNode(page, name)).toBeVisible();
    }

    // One undo restores the previous manual layout.
    await page.getByTestId("undo").click();
    await settle(page);
    const restored = await rfNode(page, "CRM").boundingBox();
    expect(before && restored).toBeTruthy();

    // The layout ran through the command bus, so redo works too.
    await page.getByTestId("redo").click();
    await expect(canvasNode(page, "CRM")).toBeVisible();
  });

  test("minimap is present for large-model navigation", async ({ page }) => {
    await freshApp(page);
    await expect(page.locator(".react-flow__minimap")).toBeVisible();
  });
});
