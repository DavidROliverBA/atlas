import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, treeItem } from "./helpers";

/** Expand the Costs section for whichever element is currently selected in the Inspector. */
async function openCosts(page: import("@playwright/test").Page) {
  if (!(await page.getByTestId("cost-add").isVisible())) {
    await page.getByTestId("costs-toggle").click();
  }
}

/** Fill in the pending/first "+ Add cost" row's label and amount and let it commit. */
async function addCost(
  page: import("@playwright/test").Page,
  opts: { label: string; amount: number },
) {
  await page.getByTestId("cost-add").click();
  const row = page.getByTestId("cost-row").last();
  await row.getByTestId("cost-label").fill(opts.label);
  await row.getByTestId("cost-label").blur();
  await row.getByTestId("cost-amount").fill(String(opts.amount));
  await row.getByTestId("cost-amount").blur();
}

test.describe("TCO (total cost of ownership)", () => {
  test("adding a recurring cost validates the pending row and commits once valid", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await expect(page.getByTestId("costs-summary")).toHaveText("No costs");

    await openCosts(page);
    await page.getByTestId("cost-add").click();
    const row = page.getByTestId("cost-row").last();

    // Fresh pending row: amount 0 and empty label — invalid, nothing dispatched yet.
    await expect(row.getByTestId("cost-error")).toHaveText("Give the entry a label");
    await expect(page.getByTestId("costs-summary")).toHaveText("No costs");

    await row.getByTestId("cost-label").fill("Card processing fees");
    await row.getByTestId("cost-label").blur();
    await expect(row.getByTestId("cost-error")).toHaveText("Amount must be greater than zero");
    await expect(page.getByTestId("costs-summary")).toHaveText("No costs");

    await row.getByTestId("cost-amount").fill("12000");
    await row.getByTestId("cost-amount").blur();

    // Now valid: committed, error clears, summary reflects the annualised total.
    await expect(row.getByTestId("cost-error")).toHaveCount(0);
    await expect(page.getByTestId("costs-summary")).toHaveText("1 entry · £12,000/yr");
  });

  test("switching an entry to monthly re-annualises the summary ×12", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "Support contract", amount: 12000 });
    await expect(page.getByTestId("costs-summary")).toHaveText("1 entry · £12,000/yr");

    const row = page.getByTestId("cost-row").last();
    await row.getByTestId("cost-period").selectOption("monthly");

    await expect(page.getByTestId("costs-summary")).toHaveText("1 entry · £144,000/yr");
  });

  test("a one-off entry amortised over N years shows amount/years as the annual TCO figure", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "CRM").click();
    await openCosts(page);
    await page.getByTestId("cost-add").click();
    const row = page.getByTestId("cost-row").last();
    await row.getByTestId("cost-label").fill("CRM migration project");
    await row.getByTestId("cost-label").blur();
    await row.getByTestId("cost-kind").selectOption("one-off");
    await row.getByTestId("cost-amortise-years").fill("3");
    await row.getByTestId("cost-amortise-years").blur();
    await row.getByTestId("cost-amount").fill("300000");
    await row.getByTestId("cost-amount").blur();
    await expect(row.getByTestId("cost-error")).toHaveCount(0);

    await page.getByTestId("open-analysis").click();
    await expect(page.getByTestId("tco-section")).toBeVisible();
    const tcoRow = page.getByTestId("tco-row").filter({ hasText: "CRM" });
    await expect(tcoRow).toContainText("£100,000");
  });

  test("roll-up: a container's cost counts in its parent system's total; the estate total counts it once", async ({
    page,
  }) => {
    await freshApp(page);

    // Own cost directly on the system.
    await treeItem(page, "Booking Engine").click();
    await openCosts(page);
    await addCost(page, { label: "Booking support team", amount: 20000 });

    // Cost on a container living inside that system.
    await treeItem(page, "Web App").click();
    await openCosts(page);
    await addCost(page, { label: "Web hosting", amount: 5000 });

    await page.getByTestId("open-analysis").click();
    const bookingRow = page.getByTestId("tco-row").filter({ hasText: "Booking Engine" });
    const webAppRow = page.getByTestId("tco-row").filter({ hasText: "Web App" });
    await expect(bookingRow).toBeVisible();
    await expect(webAppRow).toBeVisible();

    const cells = bookingRow.locator("td");
    const ownText = await cells.nth(1).innerText();
    const rolledUpText = await cells.nth(2).innerText();
    const own = Number(ownText.replace(/[^0-9.-]/g, ""));
    const rolledUp = Number(rolledUpText.replace(/[^0-9.-]/g, ""));
    expect(rolledUp).toBeGreaterThan(own);
    expect(rolledUp).toBe(25000);
    expect(own).toBe(20000);

    // Estate run-rate counts each cost exactly once: 20000 + 5000, not 20000 + 5000 + 25000.
    await expect(page.getByTestId("tco-total-annual")).toHaveText("£25,000/yr");
  });

  test("switching the horizon from 5 to 10 years doubles a recurring-only element's TCO", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "Platform fee", amount: 10000 });

    await page.getByTestId("open-analysis").click();
    await expect(page.getByTestId("tco-years")).toHaveValue("5");
    const paymentsRow = page.getByTestId("tco-row").filter({ hasText: "Payments" });
    await expect(paymentsRow).toContainText("£50,000");

    await page.getByTestId("tco-years").selectOption("10");
    await expect(paymentsRow).toContainText("£100,000");
  });

  test("CSV export downloads atlas-tco.csv with a matching header and one line per row", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "Platform fee", amount: 10000 });

    await canvasNode(page, "CRM").click();
    await openCosts(page);
    await addCost(page, { label: "CRM licence", amount: 5000 });

    await page.getByTestId("open-analysis").click();
    const rowCount = await page.getByTestId("tco-row").count();
    expect(rowCount).toBe(2);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("tco-export-csv").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("atlas-tco.csv");

    const fs = await import("node:fs");
    const content = fs.readFileSync((await download.path())!, "utf8");
    const lines = content.trim().split("\n");
    expect(lines[0]).toBe("element,kind,own_annual,rolled_up_annual,tco_5yr");
    expect(lines.length).toBe(1 + rowCount);
  });

  test("cost overlay badges the costly node and skips zero-cost nodes; toggling off hides them", async ({
    page,
  }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "Platform fee", amount: 10000 });

    await page.getByTestId("open-analysis").click();
    await page.getByTestId("tco-overlay-toggle").check();
    await page.getByTestId("analysis-close").click();

    await expect(canvasNode(page, "Payments").getByTestId("cost-badge")).toBeVisible();
    await expect(canvasNode(page, "CRM").getByTestId("cost-badge")).toHaveCount(0);

    await page.getByTestId("open-analysis").click();
    await page.getByTestId("tco-overlay-toggle").uncheck();
    await page.getByTestId("analysis-close").click();
    await expect(canvasNode(page, "Payments").getByTestId("cost-badge")).toHaveCount(0);
  });

  test("the timeline run-rate chip shows the estate figure and drops an entry once its validTo is scrubbed past", async ({
    page,
  }) => {
    await freshApp(page);
    await canvasNode(page, "CRM").click();
    await openCosts(page);
    await addCost(page, { label: "CRM support", amount: 24000 });
    const row = page.getByTestId("cost-row").last();
    await row.getByTestId("cost-valid-to").fill("2026-12-31");

    const chip = page.getByTestId("timeline-runrate");
    await expect(chip).not.toHaveText("Run rate: £0/yr");

    const scrubber = page.getByTestId("time-scrubber");
    await scrubber.fill("0");
    await expect(chip).not.toHaveText("Run rate: £0/yr");

    await scrubber.fill(String(await scrubber.evaluate((el: HTMLInputElement) => el.max)));
    await expect(chip).toHaveText("Run rate: £0/yr");
  });

  test("diff mode shows a non-zero annual and 5-yr TCO delta for a cost pinned to one state", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "Target platform fee", amount: 50000 });
    const row = page.getByTestId("cost-row").last();
    await row.getByTestId("cost-state-Target 2028").check();

    await page.getByTestId("diff-toggle").click();
    const diff = page.getByTestId("timeline-cost-diff");
    await expect(diff).toBeVisible();
    await expect(diff).toContainText(/Annual: .* → .* \(Δ/);
    await expect(diff).toContainText("5-yr TCO Δ");
    await expect(diff).not.toContainText("Δ £0");
  });

  test("undo reverts a cost addition; redo restores it", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "Support", amount: 12000 });
    await expect(page.getByTestId("costs-summary")).toHaveText("1 entry · £12,000/yr");

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("costs-summary")).toHaveText("No costs");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.getByTestId("costs-summary")).toHaveText("1 entry · £12,000/yr");
  });

  test("deleting the last cost entry returns the summary to 'No costs'", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "Support", amount: 12000 });
    await expect(page.getByTestId("costs-summary")).toHaveText("1 entry · £12,000/yr");

    await page.getByTestId("cost-row").last().getByTestId("cost-delete").click();
    await expect(page.getByTestId("costs-summary")).toHaveText("No costs");
  });

  test("a fresh workspace shows the empty TCO state in the Analysis drawer", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("open-analysis").click();
    await expect(page.getByTestId("tco-section")).toBeVisible();
    await expect(page.getByTestId("tco-empty")).toBeVisible();
    await expect(page.getByTestId("tco-table")).toHaveCount(0);
  });
});
