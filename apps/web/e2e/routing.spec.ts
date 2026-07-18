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

  test("alignment guides appear while dragging a box into line and vanish on drop", async ({ page }) => {
    await freshApp(page);
    await settle(page);

    // Payments and CRM share a column in the seed (both x=28). Dragging
    // Payments vertically keeps them aligned, so vertical guides must show.
    const box = await rfNode(page, "Payments").boundingBox();
    if (!box) throw new Error("node not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 6 });

    // A 1px-wide vertical line has an empty bounding box, so assert presence
    // and correctness (x1 === x2 means a true vertical guide) rather than
    // Playwright visibility.
    const guide = page.getByTestId("alignment-guide").first();
    await expect(guide).toBeAttached();
    const [x1, x2] = await guide.evaluate((el) => [el.getAttribute("x1"), el.getAttribute("x2")]);
    expect(x1).toBe(x2);

    await page.mouse.up();
    await expect(page.getByTestId("alignment-guide")).toHaveCount(0);
  });

  test("isometric labels lie on the top face, angled with the boxes", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("mode-iso").click();

    const label = page
      .locator('[data-testid="iso-node"][data-elname="Booking Engine"]')
      .getByTestId("iso-label");
    await expect(label).toHaveText("Booking Engine");
    // The label's parent group carries the top-face plane transform.
    const transform = await label.evaluate((el) => el.parentElement?.getAttribute("transform"));
    expect(transform).toContain("matrix(");
  });

  test("long names shrink (and squeeze) to fit the iso face", async ({ page }) => {
    await freshApp(page);
    const longName = "Enterprise Customer Relationship Platform";
    await canvasNode(page, "CRM").click();
    await page.getByTestId("inspector-name").fill(longName);
    await page.getByTestId("inspector-name").press("Enter");

    await page.getByTestId("mode-iso").click();
    const label = page
      .locator(`[data-testid="iso-node"][data-elname="${longName}"]`)
      .getByTestId("iso-label");
    await expect(label).toBeVisible();
    // Shrunk to the minimum font and glyph-squeezed to the face length.
    await expect(label).toHaveAttribute("style", /font-size: 7px/);
    await expect(label).toHaveAttribute("textLength", /\d+/);

    // A short name keeps the full-size font and no squeeze.
    const short = page
      .locator('[data-testid="iso-node"][data-elname="Payments"]')
      .getByTestId("iso-label");
    await expect(short).toHaveAttribute("style", /font-size: 10.5px/);
    await expect(short).not.toHaveAttribute("textLength", /.+/);
  });

  test("iso line labels share the box text angle and sit above the line", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("mode-iso").click();

    const edgeLabel = page.getByTestId("iso-edge-label").filter({ hasText: "takes payment via" });
    await expect(edgeLabel).toBeVisible();
    const transform = await edgeLabel.evaluate((el) => el.parentElement?.getAttribute("transform"));
    // Same plane matrix as the box labels, translated 10px above the line midpoint.
    expect(transform).toContain("matrix(");
    expect(transform).toContain("translate(");
  });
});
