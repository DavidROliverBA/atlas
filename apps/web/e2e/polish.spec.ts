import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, settle, treeItem } from "./helpers";

test.describe("M9 polish: shortcuts, tag overlays, PNG, imports", () => {
  test("Delete removes the selected element from the view but never from the model", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "CRM").click();
    await page.keyboard.press("Delete");

    await expect(canvasNode(page, "CRM")).toHaveCount(0);
    await expect(treeItem(page, "CRM")).toBeVisible(); // still in the model

    // Escape clears selection.
    await canvasNode(page, "Payments").click();
    await expect(page.getByTestId("inspector-name")).toHaveValue("Payments");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("inspector-empty")).toBeVisible();
  });

  test("Delete on a selected relationship deletes it", async ({ page }) => {
    await freshApp(page);
    await settle(page);
    await page
      .locator(".react-flow__edge", { hasText: "takes payment via" })
      .locator(".react-flow__edge-textbg")
      .click();
    await page.keyboard.press("Delete");
    await expect(page.locator(".react-flow__edge")).toHaveCount(3);
  });

  test("tag colour overlay highlights matching elements", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("tag-overlay").selectOption("legacy");
    await expect(canvasNode(page, "Legacy Mainframe")).toHaveAttribute("data-tagged", "true");
    await expect(canvasNode(page, "Booking Engine")).not.toHaveAttribute("data-tagged", "true");
    await page.getByTestId("tag-overlay").selectOption("");
    await expect(canvasNode(page, "Legacy Mainframe")).not.toHaveAttribute("data-tagged", "true");
  });

  test("current view exports as PNG", async ({ page }) => {
    await freshApp(page);
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export").click();
    await page.getByTestId("export-png").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("landscape.png");
    const fs = await import("node:fs");
    const bytes = fs.readFileSync((await download.path())!);
    // PNG magic number.
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(bytes.length).toBeGreaterThan(5000);
  });

  test("imports a Structurizr JSON workspace via the toolbar", async ({ page }) => {
    await freshApp(page);
    const structurizr = {
      name: "Imported Bank",
      model: {
        people: [{ id: "1", name: "Bank Customer", relationships: [{ sourceId: "1", destinationId: "2", description: "uses" }] }],
        softwareSystems: [{ id: "2", name: "Online Banking" }],
      },
    };
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByTestId("import").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "bank.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(structurizr)),
    });

    await expect(page.getByTestId("workspace-name")).toHaveText("Imported Bank");
    await expect(canvasNode(page, "Bank Customer")).toBeVisible();
    await expect(canvasNode(page, "Online Banking")).toBeVisible();
    await expect(page.getByText("uses")).toBeVisible();
  });

  test("imports an ArchiMate Open Exchange file via the toolbar", async ({ page }) => {
    await freshApp(page);
    const xml = `<?xml version="1.0"?>
<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" identifier="m">
  <name xml:lang="en">Archi Estate</name>
  <elements>
    <element identifier="a" xsi:type="BusinessActor"><name xml:lang="en">Adjuster</name></element>
    <element identifier="b" xsi:type="ApplicationComponent"><name xml:lang="en">Claims App</name></element>
  </elements>
  <relationships>
    <relationship identifier="r" xsi:type="Serving" source="b" target="a"/>
  </relationships>
</model>`;
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByTestId("import").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "estate.xml", mimeType: "application/xml", buffer: Buffer.from(xml) });

    await expect(page.getByTestId("workspace-name")).toHaveText("Archi Estate");
    await expect(canvasNode(page, "Adjuster")).toBeVisible();
    await expect(canvasNode(page, "Claims App")).toBeVisible();
  });
});
