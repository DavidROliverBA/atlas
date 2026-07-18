import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, treeItem } from "./helpers";

test.describe("time authoring UI (states manager + temporal editor) and view management", () => {
  test("states can be created, renamed, dated and deleted from the timeline bar", async ({ page }) => {
    await freshApp(page);
    page.on("dialog", (d) => d.accept());

    await page.getByTestId("states-manage").click();
    await page.getByTestId("state-add").click();
    await expect(page.getByTestId("time-state-New state")).toBeVisible();

    // Rename + date it.
    const row = page.getByTestId("state-row-New state");
    await row.locator("input").first().fill("Q2 2027 Transition");
    await row.locator("input").first().blur();
    await expect(page.getByTestId("time-state-Q2 2027 Transition")).toBeVisible();
    await page
      .getByTestId("state-row-Q2 2027 Transition")
      .locator('input[type="date"]')
      .fill("2027-06-30");

    // Delete it; chip disappears; undo brings it back.
    await page.getByTestId("state-delete-Q2 2027 Transition").click();
    await expect(page.getByTestId("time-state-Q2 2027 Transition")).toHaveCount(0);
    await page.getByTestId("undo").click();
    await expect(page.getByTestId("time-state-Q2 2027 Transition")).toBeVisible();
  });

  test("element validity set in the inspector drives the scrubber", async ({ page }) => {
    await freshApp(page);

    // Retire the CRM via the inspector's temporal editor.
    await canvasNode(page, "CRM").click();
    await page.getByTestId("temporal-to").fill("2026-12-31");

    // Scrub past the retirement date: CRM disappears; scrub back: returns.
    const scrubber = page.getByTestId("time-scrubber");
    await scrubber.fill(String(await scrubber.evaluate((el: HTMLInputElement) => el.max)));
    await expect(canvasNode(page, "CRM")).toHaveCount(0);
    await scrubber.fill("0");
    await expect(canvasNode(page, "CRM")).toBeVisible();

    // Clearing the date restores permanence.
    await canvasNode(page, "CRM").click();
    await page.getByTestId("temporal-to").fill("");
    await scrubber.fill(String(await scrubber.evaluate((el: HTMLInputElement) => el.max)));
    await expect(canvasNode(page, "CRM")).toBeVisible();
  });

  test("state membership checkboxes pin elements into states", async ({ page }) => {
    await freshApp(page);

    // Pin the Legacy Mainframe (validTo 2027) into Target 2028 explicitly.
    await canvasNode(page, "Legacy Mainframe").click();
    await page.getByTestId("temporal-state-Target 2028").check();

    await page.getByTestId("time-state-Target 2028").click();
    await expect(canvasNode(page, "Legacy Mainframe")).toBeVisible(); // membership beats dates

    // But it is now absent from Current (explicit membership is exclusive).
    await page.getByTestId("time-state-Current").click();
    await expect(canvasNode(page, "Legacy Mainframe")).toHaveCount(0);

    // Uncheck restores date-based behaviour.
    await page.getByTestId("time-all").click();
    await canvasNode(page, "Legacy Mainframe").click();
    await page.getByTestId("temporal-state-Target 2028").uncheck();
    await page.getByTestId("time-state-Current").click();
    await expect(canvasNode(page, "Legacy Mainframe")).toBeVisible();
  });

  test("views can be created, renamed and deleted from the sidebar", async ({ page }) => {
    await freshApp(page);
    page.on("dialog", (d) => {
      if (d.type() === "prompt") {
        void d.accept(d.defaultValue() === "New view" ? "Scratch board" : "Ops board");
      } else {
        void d.accept();
      }
    });

    // Create: prompt-named custom view becomes active and empty.
    await page.getByTestId("view-new").click();
    await expect(page.getByTestId("view-Scratch board")).toBeVisible();
    await expect(page.getByTestId("canvas-node")).toHaveCount(0);

    // Populate it from the tree, proving elements are reusable across views.
    await treeItem(page, "Payments").hover();
    await page.getByTestId("place-Payments").click();
    await expect(canvasNode(page, "Payments")).toBeVisible();

    // Rename via the hover action.
    await page.getByTestId("view-Scratch board").hover();
    await page.getByTestId("view-rename-Scratch board").click();
    await expect(page.getByTestId("view-Ops board")).toBeVisible();

    // Delete: falls back to the landscape; the model is untouched.
    await page.getByTestId("view-Ops board").hover();
    await page.getByTestId("view-delete-Ops board").click();
    await expect(page.getByTestId("view-Ops board")).toHaveCount(0);
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
    await expect(treeItem(page, "Payments")).toBeVisible();
  });

  test("relationship temporal editing works from the inspector", async ({ page }) => {
    await freshApp(page);
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);

    await page
      .locator(".react-flow__edge", { hasText: "takes payment via" })
      .locator(".react-flow__edge-textbg")
      .click();
    await page.getByTestId("temporal-to").fill("2026-12-31");

    const scrubber = page.getByTestId("time-scrubber");
    await scrubber.fill(String(await scrubber.evaluate((el: HTMLInputElement) => el.max)));
    // Mainframe also retires by then, so two edges go (legacy sync + this one).
    await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  });
});
