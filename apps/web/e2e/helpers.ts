import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Load the app and wait for the canvas. Each Playwright test gets an isolated
 * browser context, so localStorage always starts empty (demo seed).
 */
export async function freshApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(canvasNode(page, "Booking Engine")).toBeVisible();
}

/** The inner custom node body for an element, by name. */
export function canvasNode(page: Page, name: string): Locator {
  return page.locator(`[data-testid="canvas-node"][data-elname="${name}"]`);
}

/** The React Flow node wrapper (drag target, holds handles) for an element. */
export function rfNode(page: Page, name: string): Locator {
  return page.locator(".react-flow__node", { has: canvasNode(page, name) });
}

export function treeItem(page: Page, name: string): Locator {
  return page.getByTestId(`tree-${name}`);
}

/** Wait for the canvas viewport animation (fitView) to finish moving nodes. */
export async function settle(page: Page): Promise<void> {
  const node = page.locator(".react-flow__node").first();
  let prev = await node.boundingBox();
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(120);
    const cur = await node.boundingBox();
    if (prev && cur && Math.abs(cur.x - prev.x) < 0.5 && Math.abs(cur.y - prev.y) < 0.5) return;
    prev = cur;
  }
}

/** Drag a connection from one node's source handle to another node's target handle. */
export async function connectNodes(page: Page, from: string, to: string): Promise<void> {
  await settle(page);
  const source = rfNode(page, from).locator('.react-flow__handle[data-handlepos="right"]');
  const target = rfNode(page, to).locator('.react-flow__handle[data-handlepos="left"]');
  const sBox = await source.boundingBox();
  const tBox = await target.boundingBox();
  if (!sBox || !tBox) throw new Error("Handles not visible");
  await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2, { steps: 12 });
  await page.mouse.up();
}
