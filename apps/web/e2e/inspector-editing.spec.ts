import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, settle } from "./helpers";

test.describe("inspector editing", () => {
  test("hiding and showing a relationship on the active view; undo/redo", async ({ page }) => {
    await freshApp(page);
    await settle(page);

    await page
      .locator(".react-flow__edge", { hasText: "takes payment via" })
      .locator(".react-flow__edge-textbg")
      .click();
    await expect(page.getByTestId("inspector-relationship")).toBeVisible();
    await expect(page.getByTestId("rel-hide")).toBeVisible();

    await page.getByTestId("rel-hide").click();
    await expect(page.locator(".react-flow__edge", { hasText: "takes payment via" })).toHaveCount(0);

    // Hiding never clears the selection, so the same relationship's
    // inspector panel is still open — rel-show is right there.
    await expect(page.getByTestId("rel-show")).toBeVisible();
    await page.getByTestId("rel-show").click();
    await expect(page.locator(".react-flow__edge", { hasText: "takes payment via" })).toBeVisible();

    await page.getByTestId("rel-hide").click();
    await expect(page.locator(".react-flow__edge", { hasText: "takes payment via" })).toHaveCount(0);

    await page.getByTestId("undo").click();
    await expect(page.locator(".react-flow__edge", { hasText: "takes payment via" })).toBeVisible();

    await page.getByTestId("redo").click();
    await expect(page.locator(".react-flow__edge", { hasText: "takes payment via" })).toHaveCount(0);
  });

  test("state overrides: set, view under a state, undo, and clear", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("view-Booking Engine — containers").click();
    await settle(page);

    await canvasNode(page, "Booking API").click();
    await expect(canvasNode(page, "Booking API")).toContainText("Kotlin, Spring Boot");

    await page.getByTestId("overrides-toggle").click();
    await page.getByTestId("overrides-state-picker").selectOption({ label: "Target 2028" });
    await page.getByTestId("override-technology").fill("Rust, Actix");
    await page.getByTestId("override-technology").blur();
    await expect(page.getByTestId("overrides-summary")).toHaveText("1 state");

    // The canvas shows the override only while that state is the active lens.
    await page.getByTestId("time-state-Target 2028").click();
    await expect(canvasNode(page, "Booking API")).toContainText("Rust, Actix");
    await expect(canvasNode(page, "Booking API")).not.toContainText("Kotlin, Spring Boot");

    await page.getByTestId("time-all").click();
    await expect(canvasNode(page, "Booking API")).toContainText("Kotlin, Spring Boot");

    // Undo removes the override outright — even while viewing that state.
    await page.getByTestId("time-state-Target 2028").click();
    await expect(canvasNode(page, "Booking API")).toContainText("Rust, Actix");
    await page.getByTestId("undo").click();
    await expect(canvasNode(page, "Booking API")).toContainText("Kotlin, Spring Boot");

    await page.getByTestId("redo").click();
    await expect(canvasNode(page, "Booking API")).toContainText("Rust, Actix");

    // overrides-clear removes just this state's override.
    await page.getByTestId("overrides-clear").click();
    await expect(canvasNode(page, "Booking API")).toContainText("Kotlin, Spring Boot");
    await expect(page.getByTestId("overrides-summary")).toHaveText("No overrides");
  });

  test("tags: add via Enter and comma, remove via chip, persists across reload", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "CRM").click();

    await page.getByTestId("tag-input").fill("customer-data");
    await page.getByTestId("tag-input").press("Enter");
    await page.getByTestId("tag-input").fill("critical");
    await page.getByTestId("tag-input").press(",");

    const chips = page.getByTestId("tag-chip");
    await expect(chips).toHaveCount(2);
    await expect(chips.filter({ hasText: "customer-data" })).toBeVisible();
    await expect(chips.filter({ hasText: "critical" })).toBeVisible();

    await chips.filter({ hasText: "customer-data" }).locator("button").click();
    await expect(chips).toHaveCount(1);
    await expect(chips.filter({ hasText: "critical" })).toBeVisible();

    await page.reload();
    await canvasNode(page, "CRM").click();
    await expect(page.getByTestId("tag-chip")).toHaveCount(1);
    await expect(page.getByTestId("tag-chip").filter({ hasText: "critical" })).toBeVisible();
  });

  test("links: add, edit title, remove", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "CRM").click();

    await page.getByTestId("link-add").click();
    await expect(page.getByTestId("link-row")).toHaveCount(1);

    await page.getByTestId("link-title").fill("Runbook");
    await page.getByTestId("link-title").blur();
    await page.getByTestId("link-url").fill("https://wiki.example.com/crm-runbook");
    await page.getByTestId("link-url").blur();
    await expect(page.getByTestId("link-title")).toHaveValue("Runbook");
    await expect(page.getByTestId("link-url")).toHaveValue("https://wiki.example.com/crm-runbook");

    await page.getByTestId("link-title").fill("CRM Runbook");
    await page.getByTestId("link-title").blur();
    await expect(page.getByTestId("link-title")).toHaveValue("CRM Runbook");

    await page.reload();
    await canvasNode(page, "CRM").click();
    await expect(page.getByTestId("link-title")).toHaveValue("CRM Runbook");
    await expect(page.getByTestId("link-url")).toHaveValue("https://wiki.example.com/crm-runbook");

    await page.getByTestId("link-remove").click();
    await expect(page.getByTestId("link-row")).toHaveCount(0);
  });

  test("switching selection after adding a pending (uncommitted) cost leaves exactly one costs section", async ({
    page,
  }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await page.getByTestId("costs-toggle").click();
    await page.getByTestId("cost-add").click();
    await expect(page.getByTestId("cost-row")).toBeVisible();

    // Switch selection before the pending (amount-0, invalid) row ever commits.
    await canvasNode(page, "CRM").click();

    await expect(page.getByTestId("costs-section")).toHaveCount(1);
    await expect(page.getByTestId("costs-summary")).toHaveText("No costs");
  });
});
