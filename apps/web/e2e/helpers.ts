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

/** Drag a connection between two nodes' ports (defaults: right-mid → left-mid). */
export async function connectNodes(
  page: Page,
  from: string,
  to: string,
  fromPort = "r1",
  toPort = "l1",
): Promise<void> {
  await settle(page);
  // Ports fade in on hover; hover each node first so they are interactable.
  await rfNode(page, from).hover();
  const source = rfNode(page, from).locator(`.react-flow__handle[data-handleid="${fromPort}"]`);
  const sBox = await source.boundingBox();
  if (!sBox) throw new Error("Source port not visible");
  await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
  await page.mouse.down();
  const target = rfNode(page, to).locator(`.react-flow__handle[data-handleid="${toPort}"]`);
  const tBox = await target.boundingBox();
  if (!tBox) throw new Error("Target port not visible");
  await page.mouse.move(tBox.x + tBox.width / 2, tBox.y + tBox.height / 2, { steps: 12 });
  await page.mouse.up();
}
