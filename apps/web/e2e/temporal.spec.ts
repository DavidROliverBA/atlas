import { expect, test } from "@playwright/test";
import { canvasNode, freshApp } from "./helpers";

test.describe("time as a first-class dimension (M6)", () => {
  test("named states re-evaluate visibility", async ({ page }) => {
    await freshApp(page);
    await expect(canvasNode(page, "Legacy Mainframe")).toBeVisible();

    // In the 2028 target state the mainframe (validTo 2027-12-31) is gone.
    await page.getByTestId("time-state-Target 2028").click();
    await expect(canvasNode(page, "Legacy Mainframe")).toHaveCount(0);
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();

    // Back to Current: it returns.
    await page.getByTestId("time-state-Current").click();
    await expect(canvasNode(page, "Legacy Mainframe")).toBeVisible();

    await page.getByTestId("time-all").click();
    await expect(canvasNode(page, "Legacy Mainframe")).toBeVisible();
  });

  test("the timeline scrubber shows the estate at a chosen date", async ({ page }) => {
    await freshApp(page);
    const scrubber = page.getByTestId("time-scrubber");

    // Scrub to the far end (past the mainframe's retirement).
    await scrubber.fill(String(await scrubber.evaluate((el: HTMLInputElement) => el.max)));
    await expect(page.getByTestId("time-label")).not.toHaveText("All time");
    await expect(canvasNode(page, "Legacy Mainframe")).toHaveCount(0);

    // Scrub back to the start: the mainframe exists again.
    await scrubber.fill("0");
    await expect(canvasNode(page, "Legacy Mainframe")).toBeVisible();
  });

  test("state visibility follows relationships too", async ({ page }) => {
    await freshApp(page);
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);
    await page.getByTestId("time-state-Target 2028").click();
    // The legacy sync edge disappears with its endpoint.
    await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  });

  test("per-state attribute overrides change what the canvas shows", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("view-Booking Engine — containers").click();
    await expect(canvasNode(page, "Web App")).toContainText("TypeScript, React");

    await page.getByTestId("time-state-Target 2028").click();
    await expect(canvasNode(page, "Web App")).toContainText("TypeScript, Next.js");
  });

  test("compare mode renders the diff overlay and a readable report", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("diff-toggle").click();

    // The mainframe is styled as removed but still shown for comparison.
    await expect(canvasNode(page, "Legacy Mainframe")).toHaveAttribute("data-diff", "removed");
    await expect(canvasNode(page, "Booking Engine")).not.toHaveAttribute("data-diff", /.+/);

    const report = page.getByTestId("diff-report");
    await expect(report).toContainText("- Legacy Mainframe");
    await expect(report).toContainText("~ Web App: technology");

    // Exit compare restores normal rendering.
    await page.getByTestId("diff-toggle").click();
    await expect(page.getByTestId("diff-report")).toHaveCount(0);
    await expect(canvasNode(page, "Legacy Mainframe")).not.toHaveAttribute("data-diff", /.+/);
  });

  test("temporal lens applies in isometric mode as well", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("mode-iso").click();
    await expect(page.locator('[data-testid="iso-node"][data-elname="Legacy Mainframe"]')).toBeVisible();
    await page.getByTestId("time-state-Target 2028").click();
    await expect(page.locator('[data-testid="iso-node"][data-elname="Legacy Mainframe"]')).toHaveCount(0);
  });
});
