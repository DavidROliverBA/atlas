import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, settle } from "./helpers";

test.describe("command palette (cmdk)", () => {
  test("Mod+K opens with the input focused; Esc and backdrop click both close it", async ({ page }) => {
    await freshApp(page);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("cmdk")).toBeVisible();
    await expect(page.getByTestId("cmdk-input")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("cmdk")).toHaveCount(0);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("cmdk")).toBeVisible();
    // Click the backdrop itself (top-left corner, well outside the centred
    // modal box) — the palette only closes when the click target is the
    // backdrop element, not one of its children.
    await page.getByTestId("cmdk").click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId("cmdk")).toHaveCount(0);
  });

  test("typing finds a nested element; Enter selects it in the inspector", async ({ page }) => {
    await freshApp(page);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("cmdk-input").fill("Booking API");
    await expect(page.getByTestId("cmdk-result").first()).toContainText("Booking API");

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cmdk")).toHaveCount(0);
    await expect(page.getByTestId("inspector-name")).toHaveValue("Booking API");
  });

  test("a view result switches the active view", async ({ page }) => {
    await freshApp(page);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("cmdk-input").fill("containers");
    await expect(page.getByTestId("cmdk-result").first()).toContainText("Booking Engine — containers");

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cmdk")).toHaveCount(0);
    await settle(page);
    await expect(page.getByTestId("crumb-Booking Engine")).toBeVisible();
    await expect(canvasNode(page, "Booking API")).toBeVisible();
  });

  test("Tab (or the place button) places an unplaced-but-legal element; already-placed elements show no place affordance", async ({
    page,
  }) => {
    await freshApp(page);
    await settle(page);

    // Take Payments off the active view so it's a legal, unplaced target.
    await canvasNode(page, "Payments").click();
    await page.getByTestId("remove-from-view").click();
    await expect(canvasNode(page, "Payments")).toHaveCount(0);

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("cmdk-input").fill("Payments");
    await expect(page.getByTestId("cmdk-place")).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(canvasNode(page, "Payments")).toBeVisible();
    // Now placed — the palette (still open) drops the place affordance.
    await expect(page.getByTestId("cmdk-place")).toHaveCount(0);
    await page.keyboard.press("Escape");

    // An already-placed element never shows a place affordance either.
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("cmdk-input").fill("CRM");
    await expect(page.getByTestId("cmdk-result").first()).toContainText("CRM");
    await expect(page.getByTestId("cmdk-place")).toHaveCount(0);
  });

  test("the Mod+K keybinding doesn't fire while typing in an inspector input", async ({ page }) => {
    await freshApp(page);

    await canvasNode(page, "CRM").click();
    await page.getByTestId("inspector-name").click();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("cmdk")).toHaveCount(0);
  });
});
