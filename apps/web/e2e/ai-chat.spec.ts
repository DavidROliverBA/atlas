import { expect, test, type Page, type Route } from "@playwright/test";
import { canvasNode, freshApp } from "./helpers";

/**
 * The AI turn is exercised against a stubbed Anthropic API: first response
 * asks for tool calls (create/connect/place), second response ends the turn.
 * This tests the full loop — tool execution, change-set preview, Apply as a
 * single undoable batch — without a real key.
 */

const TOOL_USE_RESPONSE = {
  id: "msg_stub_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-4-8",
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
  content: [
    { type: "text", text: "Queuing the payments gateway now." },
    {
      type: "tool_use",
      id: "toolu_1",
      name: "create_elements",
      input: {
        elements: [
          { name: "Payments Gateway", kind: "system", description: "Card orchestration", tags: ["proposed"] },
        ],
      },
    },
    {
      type: "tool_use",
      id: "toolu_2",
      name: "create_relationships",
      input: {
        relationships: [
          { source: "Booking Engine", target: "Payments Gateway", name: "authorises cards via", technology: ["Kafka"] },
        ],
      },
    },
    {
      type: "tool_use",
      id: "toolu_3",
      name: "place_on_view",
      input: { elements: ["Payments Gateway"] },
    },
  ],
};

const FINAL_RESPONSE = {
  id: "msg_stub_2",
  type: "message",
  role: "assistant",
  model: "claude-opus-4-8",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
  content: [
    {
      type: "text",
      text: "I have queued a Payments Gateway system connected to the Booking Engine over Kafka, placed on your current view.",
    },
  ],
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
};

/**
 * `delete_elements` cascades (children, their relationships, every view
 * placement) — see ChangeSetBuilder.deleteElements. "Booking Engine" has 3
 * container children and touches 6 distinct relationships once its
 * descendants are included, so this exercises the cascade-count summary.
 */
const DELETE_RESPONSE = {
  id: "msg_stub_3",
  type: "message",
  role: "assistant",
  model: "claude-opus-4-8",
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
  content: [
    { type: "text", text: "Removing the Booking Engine and everything it contains." },
    {
      type: "tool_use",
      id: "toolu_del_1",
      name: "delete_elements",
      input: { elements: ["Booking Engine"] },
    },
  ],
};

async function stubAnthropic(page: Page, first: unknown = TOOL_USE_RESPONSE): Promise<{ requests: unknown[] }> {
  const state = { calls: 0, requests: [] as unknown[] };
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    state.requests.push(route.request().postDataJSON());
    state.calls += 1;
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
      body: JSON.stringify(state.calls === 1 ? first : FINAL_RESPONSE),
    });
  });
  return state;
}

async function openChatAndAsk(
  page: Page,
  message = "Add a payments gateway connected to the booking engine over Kafka",
): Promise<void> {
  await page.getByTestId("right-tab-chat").click();
  await page.getByTestId("chat-settings").click();
  await page.getByTestId("chat-api-key").fill("sk-ant-test-key");
  await page.getByTestId("chat-settings").click();
  await page.getByTestId("chat-input").fill(message);
  await page.getByTestId("chat-send").click();
}

test.describe("AI chat (M7)", () => {
  test("a chat turn produces a proposal; Apply lands it on the model as one undo step", async ({ page }) => {
    await freshApp(page);
    const stub = await stubAnthropic(page);
    await openChatAndAsk(page);

    // Proposal preview lists the queued changes; nothing applied yet.
    const proposal = page.getByTestId("chat-proposal");
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText('Create system "Payments Gateway"');
    await expect(proposal).toContainText("Connect Booking Engine → Payments Gateway");
    await expect(proposal).toContainText('Place "Payments Gateway"');
    await expect(canvasNode(page, "Payments Gateway")).toHaveCount(0);

    // Apply: element, relationship and placement appear.
    await page.getByTestId("proposal-apply").click();
    await expect(canvasNode(page, "Payments Gateway")).toBeVisible();
    await expect(page.getByText("authorises cards via")).toBeVisible();

    // One undo step reverts the whole proposal.
    await page.getByTestId("undo").click();
    await expect(canvasNode(page, "Payments Gateway")).toHaveCount(0);
    await expect(page.getByText("authorises cards via")).toHaveCount(0);

    // The API received a compact summary, not a full serialisation.
    const firstRequest = stub.requests[0] as { messages: Array<{ content: unknown }> };
    const firstUser = JSON.stringify(firstRequest.messages.at(-1)?.content);
    expect(firstUser).toContain("model_summary");
    expect(firstUser).toContain("Booking Engine");
    expect(firstUser).not.toContain('"placements"');
  });

  test("Discard leaves the model untouched", async ({ page }) => {
    await freshApp(page);
    await stubAnthropic(page);
    await openChatAndAsk(page);

    await expect(page.getByTestId("chat-proposal")).toBeVisible();
    await page.getByTestId("proposal-discard").click();

    await expect(page.getByTestId("chat-proposal")).toHaveCount(0);
    await expect(canvasNode(page, "Payments Gateway")).toHaveCount(0);
    await expect(page.getByTestId("chat-messages")).toContainText("nothing was changed");
  });

  test("the app is fully usable without an API key; chat prompts for one", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("right-tab-chat").click();
    await page.getByTestId("chat-input").fill("hello");
    await page.getByTestId("chat-send").click();
    // No request goes out; the settings panel opens instead.
    await expect(page.getByTestId("chat-settings-panel")).toBeVisible();
    // Inspector still works.
    await page.getByTestId("right-tab-inspector").click();
    await canvasNode(page, "CRM").click();
    await expect(page.getByTestId("inspector-name")).toHaveValue("CRM");
  });

  test("a delete_elements turn shows cascade counts; Apply removes them as one undo step", async ({ page }) => {
    await freshApp(page);
    await stubAnthropic(page, DELETE_RESPONSE);
    await openChatAndAsk(page, "Delete the booking engine and everything under it");

    const proposal = page.getByTestId("chat-proposal");
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText('Delete system "Booking Engine" (+3 children, 6 relationships)');
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();

    await page.getByTestId("proposal-apply").click();
    await expect(canvasNode(page, "Booking Engine")).toHaveCount(0);
    await expect(page.locator(".react-flow__edge")).toHaveCount(0);

    await page.getByTestId("undo").click();
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  });
});
