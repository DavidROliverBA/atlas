/**
 * Not a test: captures README screenshots when SCREENSHOTS=1.
 * Run: SCREENSHOTS=1 pnpm exec playwright test screenshots
 */
import { test } from "@playwright/test";
import { canvasNode, freshApp, rfNode, settle } from "./helpers";

test.skip(!process.env.SCREENSHOTS, "screenshot capture is opt-in");

test("capture landscape and container views", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshApp(page);
  await settle(page);
  await page.screenshot({ path: "../../docs/images/landscape.png" });

  await rfNode(page, "Booking Engine").dblclick();
  await canvasNode(page, "Web App").click();
  await settle(page);
  await page.screenshot({ path: "../../docs/images/container-view.png" });
});
