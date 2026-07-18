import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, rfNode } from "./helpers";

test.describe("stencil packs (M4)", () => {
  test("palette is pack-driven; default workspace enables C4 core and generic tech", async ({ page }) => {
    await freshApp(page);
    await expect(page.getByTestId("palette-system")).toBeVisible();
    await expect(page.getByTestId("palette-database")).toBeVisible();
    // Cloud packs are off by default.
    await expect(page.getByTestId("palette-lambda")).toHaveCount(0);
  });

  test("enabling the AWS pack adds its stencils; disabling removes them (and is undoable)", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("manage-packs").click();
    await page.getByTestId("pack-toggle-aws").check();

    await page.getByTestId("palette-search").fill("lambda");
    await expect(page.getByTestId("palette-lambda")).toBeVisible();

    // Pack enablement is a command like any other: undo/redo works.
    await page.getByTestId("undo").click();
    await expect(page.getByTestId("palette-lambda")).toHaveCount(0);
    await page.getByTestId("redo").click();
    await expect(page.getByTestId("palette-lambda")).toBeVisible();

    // And it is part of the workspace manifest, so it survives a reload.
    await page.reload();
    await page.getByTestId("palette-search").fill("lambda");
    await expect(page.getByTestId("palette-lambda")).toBeVisible();
  });

  test("modelling an AWS workload with cloud-specific attributes", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("manage-packs").click();
    await page.getByTestId("pack-toggle-aws").check();

    // Cloud services map to components, so they live inside a container:
    // drill system → container first.
    await rfNode(page, "Booking Engine").dblclick();
    await rfNode(page, "Booking API").dblclick();
    await page.getByTestId("palette-search").fill("lambda");
    await page.getByTestId("palette-lambda").click();

    const node = canvasNode(page, "New Lambda Function");
    await expect(node).toBeVisible();
    await expect(node.getByTestId("stencil-symbol")).toBeVisible();
    await expect(node).toContainText("AWS Lambda");

    // Pack-specific attributes from the JSON Schema.
    await expect(page.getByTestId("stencil-attributes")).toBeVisible();
    await page.getByTestId("attr-region").fill("eu-west-2");
    await page.getByTestId("attr-region").blur();

    // Invalid account id is rejected by schema validation with a clear error.
    await page.getByTestId("attr-accountId").fill("12");
    await page.getByTestId("attr-accountId").blur();
    await expect(page.getByTestId("toast-error")).toContainText("Lambda");

    // Valid account id sticks and survives reselection.
    await page.getByTestId("attr-accountId").fill("123456789012");
    await page.getByTestId("attr-accountId").blur();
    // Reselect to prove the values read back from the model.
    await page.keyboard.press("Escape");
    await canvasNode(page, "New Lambda Function").click();
    await expect(page.getByTestId("attr-accountId")).toHaveValue("123456789012");
    await expect(page.getByTestId("attr-region")).toHaveValue("eu-west-2");
  });

  test("cloud group stencils (VPC) create boundaries, not endpoints", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("manage-packs").click();
    await page.getByTestId("pack-toggle-aws").check();
    await rfNode(page, "Booking Engine").dblclick();
    await rfNode(page, "Booking API").dblclick();

    await page.getByTestId("palette-search").fill("vpc");
    await page.getByTestId("palette-vpc").click();
    await expect(canvasNode(page, "New VPC")).toBeVisible();
  });

  test("stencil elements render in isometric mode too", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("manage-packs").click();
    await page.getByTestId("pack-toggle-aws").check();
    await rfNode(page, "Booking Engine").dblclick();
    await rfNode(page, "Booking API").dblclick();
    await page.getByTestId("palette-search").fill("s3");
    await page.getByTestId("palette-s3").click();
    await page.getByTestId("mode-iso").click();
    await expect(page.locator('[data-testid="iso-node"][data-elname="New S3 Bucket"]')).toBeVisible();
  });
});
