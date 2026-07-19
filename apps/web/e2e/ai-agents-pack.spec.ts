import { expect, test } from "@playwright/test";
import { canvasNode, freshApp, rfNode } from "./helpers";

/**
 * The `ai-agents` pack (docs/research-ai-agents.md) ships enabled by default
 * (unlike the opt-in cloud/business packs), so these tests never need to
 * touch the Packs… manager.
 */
test.describe("ai-agents stencil pack", () => {
  test("agent stencils appear in the Container section on a container view; tool stencils in the Component section on a component view", async ({
    page,
  }) => {
    await freshApp(page);

    // Drill into Booking Engine's container view.
    await rfNode(page, "Booking Engine").dblclick();
    await expect(page.getByTestId("palette-level-container")).toBeVisible();
    const agentButton = page.getByTestId("palette-agent");
    await expect(agentButton).toBeVisible();
    await expect(agentButton).toBeEnabled();
    // It lives under the Container level heading, not Component.
    await expect(page.getByTestId("palette-level-container").getByTestId("palette-agent")).toHaveCount(1);
    await expect(page.getByTestId("palette-level-component")).not.toContainText("AI Agent");

    // Place an agent, then drill into it — an empty component view is
    // auto-created on first drill, same as any other container.
    await page.getByTestId("palette-agent").click();
    await rfNode(page, "New AI Agent").dblclick();
    await expect(page.getByTestId("palette-level-component")).toBeVisible();
    const toolButton = page.getByTestId("palette-tool");
    await expect(toolButton).toBeVisible();
    await expect(toolButton).toBeEnabled();
    await expect(page.getByTestId("palette-level-component").getByTestId("palette-tool")).toHaveCount(1);
    await expect(page.getByTestId("palette-level-container")).not.toContainText("Tool");
  });

  test("placing an agent creates a container carrying the ai-agents/agent stencil ref", async ({ page }) => {
    await freshApp(page);
    await rfNode(page, "Booking Engine").dblclick();

    await page.getByTestId("palette-agent").click();
    const node = canvasNode(page, "New AI Agent");
    await expect(node).toBeVisible();
    await expect(node.getByTestId("stencil-symbol")).toBeVisible();

    // The Inspector's stencil-attributes panel only renders for elements
    // carrying a stencil ref, keyed to that stencil's own schema.
    await expect(page.getByTestId("stencil-attributes")).toContainText("AI Agent attributes");
  });

  test("the Inspector shows the agent's attribute fields and edits round-trip; invalid enum values are rejected", async ({
    page,
  }) => {
    await freshApp(page);
    await rfNode(page, "Booking Engine").dblclick();
    await page.getByTestId("palette-agent").click();

    await expect(page.getByTestId("stencil-attributes")).toBeVisible();
    await page.getByTestId("attr-autonomyLevel").fill("approve");
    await page.getByTestId("attr-autonomyLevel").blur();
    await page.getByTestId("attr-model").fill("claude-opus-4-6");
    await page.getByTestId("attr-model").blur();

    // Bad enum value is rejected by schema validation with a named error.
    await page.getByTestId("attr-autonomyLevel").fill("yolo");
    await page.getByTestId("attr-autonomyLevel").blur();
    await expect(page.getByTestId("toast-error")).toContainText("AI Agent");

    // Fix it back, then prove the values read back from the model on reselection.
    await page.getByTestId("attr-autonomyLevel").fill("approve");
    await page.getByTestId("attr-autonomyLevel").blur();
    await page.keyboard.press("Escape");
    await canvasNode(page, "New AI Agent").click();
    await expect(page.getByTestId("attr-autonomyLevel")).toHaveValue("approve");
    await expect(page.getByTestId("attr-model")).toHaveValue("claude-opus-4-6");
  });

  test("agent-swarm creates a group boundary, not an endpoint", async ({ page }) => {
    await freshApp(page);
    await rfNode(page, "Booking Engine").dblclick();
    await page.getByTestId("palette-agent-swarm").click();
    await expect(canvasNode(page, "New Agent Swarm")).toBeVisible();
  });

  test("placement rules: the agent (container) stencil is disabled on the Context-level landscape view", async ({
    page,
  }) => {
    await freshApp(page);
    // The Landscape view is a "context level" view: only Person/System/Group place here.
    await expect(page.getByTestId("palette-level-container-unavailable")).toBeVisible();
    await expect(page.getByTestId("palette-agent")).toBeDisabled();
    await expect(page.getByTestId("palette-agent")).toHaveAttribute(
      "title",
      /not available on this .* view/,
    );
  });
});
