import { expect, test, type Page, type Route } from "@playwright/test";
import { canvasNode, freshApp, rfNode, treeItem } from "./helpers";

/**
 * Coverage for the latest fix wave: per-currency TCO, lint severity/domain
 * rules, compare pickers + state reordering, TCO scoping, ⌘K deep search,
 * views grouping, cost CSV import, chat streaming/persistence, and AI-driven
 * stencil creation. One issue (db outage banner) is already covered by
 * db-roundtrip.spec.ts's "outage handling" test and is deliberately not
 * duplicated here.
 */

/** Expand the Costs section for whichever element is currently selected in the Inspector (see tco.spec.ts). */
async function openCosts(page: Page): Promise<void> {
  if (!(await page.getByTestId("cost-add").isVisible())) {
    await page.getByTestId("costs-toggle").click();
  }
}

/** Fill in a fresh "+ Add cost" row's label/amount(/currency) and let it commit. */
async function addCost(
  page: Page,
  opts: { label: string; amount: number; currency?: string },
): Promise<void> {
  await page.getByTestId("cost-add").click();
  const row = page.getByTestId("cost-row").last();
  await row.getByTestId("cost-label").fill(opts.label);
  await row.getByTestId("cost-label").blur();
  await row.getByTestId("cost-amount").fill(String(opts.amount));
  await row.getByTestId("cost-amount").blur();
  if (opts.currency) {
    await row.getByTestId("cost-currency").fill(opts.currency);
    await row.getByTestId("cost-currency").blur();
  }
}

/**
 * Create a named state via the States manager. Date is set before the rename
 * so the row's name-keyed `data-testid` (`state-row-<name>`) is still the
 * default "New state" while we locate its date input.
 */
async function addNamedState(page: Page, name: string, date: string): Promise<void> {
  await page.getByTestId("states-manage").click();
  await page.getByTestId("state-add").click();
  const row = page.getByTestId("state-row-New state");
  await row.locator("input").nth(1).fill(date);
  await row.locator("input").nth(0).fill(name);
  await row.locator("input").nth(0).blur();
  await page.getByTestId("states-manage").click();
}

test.describe("per-currency TCO", () => {
  test("an element with costs in two currencies shows separate per-currency totals, never a mixed sum", async ({
    page,
  }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "UK support contract", amount: 24000 });
    await addCost(page, { label: "US support contract", amount: 12000, currency: "USD" });

    await page.getByTestId("open-analysis").click();
    await expect(page.getByTestId("tco-mixed-warning")).toBeVisible();

    const totalAnnual = page.getByTestId("tco-total-annual");
    await expect(totalAnnual).toContainText("£24,000/yr");
    await expect(totalAnnual).toContainText("US$12,000/yr");
    await expect(totalAnnual).toContainText(" + ");

    const total5yr = page.getByTestId("tco-total");
    await expect(total5yr).toContainText("£120,000");
    await expect(total5yr).toContainText("US$60,000");

    const runRate = page.getByTestId("timeline-runrate");
    await expect(runRate).toContainText("£24k");
    await expect(runRate).toContainText("US$12k");
    await expect(runRate).toContainText(" + ");
  });

  test("a single-currency estate keeps the plain (non-mixed) total format", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "Support", amount: 24000 });

    await page.getByTestId("open-analysis").click();
    await expect(page.getByTestId("tco-mixed-warning")).toHaveCount(0);
    await expect(page.getByTestId("tco-total-annual")).toHaveText("£24,000/yr");
    await expect(page.getByTestId("tco-total-annual")).not.toContainText("+");
    await expect(page.getByTestId("timeline-runrate")).toHaveText("Run rate: £24k/yr");
  });
});

test.describe("lint severity and domain rules", () => {
  test("an unowned critical element and its estimate-confidence live cost get distinct severity styling", async ({
    page,
  }) => {
    await freshApp(page);
    await treeItem(page, "Payments").click();
    await page.getByTestId("inspector-criticality").selectOption("critical");
    await openCosts(page);
    // No confidence set (defaults to "estimate") on a live element — also exercises estimate-cost-on-live (info).
    await addCost(page, { label: "Ad-hoc hosting", amount: 8000 });

    await page.getByTestId("open-analysis").click();

    const unowned = page.getByTestId("lint-issue").filter({ hasText: "no owners or team" });
    await expect(unowned).toBeVisible();
    await expect(unowned).toHaveAttribute("data-severity", "warning");
    await expect(unowned).toHaveClass(/border-orange-200/);

    const estimateOnLive = page.getByTestId("lint-issue").filter({ hasText: "estimate-confidence cost" });
    await expect(estimateOnLive).toBeVisible();
    await expect(estimateOnLive).toHaveAttribute("data-severity", "info");
    await expect(estimateOnLive).toHaveClass(/border-slate-200/);
  });

  test("an ai-agents agent with no guardrail relationship is flagged agent-without-guardrail", async ({ page }) => {
    await freshApp(page);
    await rfNode(page, "Booking Engine").dblclick();
    await page.getByTestId("palette-agent").click();

    await page.getByTestId("open-analysis").click();
    const issue = page.getByTestId("lint-issue").filter({ hasText: "no relationship to a guardrail" });
    await expect(issue).toBeVisible();
    await expect(issue).toHaveAttribute("data-severity", "warning");
  });

  test("clicking the duplicate-name chip cycles selection between the two offenders", async ({ page }) => {
    await freshApp(page);
    // The palette auto-numbers a second default name ("... 2") to avoid a clash,
    // so rename it back to match the first — a deliberate duplicate, same scope.
    await page.getByTestId("palette-system").click();
    await page.getByTestId("inspector-description").fill("First dup");
    await page.getByTestId("inspector-description").blur();
    await page.getByTestId("palette-system").click();
    await page.getByTestId("inspector-description").fill("Second dup");
    await page.getByTestId("inspector-description").blur();
    await page.getByTestId("inspector-name").fill("New Software System");
    await page.getByTestId("inspector-name").blur();

    await page.getByTestId("open-analysis").click();
    const dup = page.getByTestId("lint-issue").filter({ hasText: "share the same scope" });
    await expect(dup).toBeVisible();
    await expect(dup).toHaveAttribute("data-severity", "warning");

    const treeItems = page.getByTestId("tree-New Software System");
    await expect(treeItems).toHaveCount(2);

    await dup.click();
    await expect(treeItems.nth(0)).toHaveClass(/bg-blue-100/);
    await expect(treeItems.nth(1)).not.toHaveClass(/bg-blue-100/);
    await expect(page.getByTestId("inspector-description")).toHaveValue("First dup");

    await dup.click();
    await expect(treeItems.nth(1)).toHaveClass(/bg-blue-100/);
    await expect(treeItems.nth(0)).not.toHaveClass(/bg-blue-100/);
    await expect(page.getByTestId("inspector-description")).toHaveValue("Second dup");

    await dup.click(); // cycles back round to the first offender
    await expect(page.getByTestId("inspector-description")).toHaveValue("First dup");
  });
});

test.describe("compare pickers and state reordering", () => {
  test("picking the middle and last states in diff-a/diff-b changes the diff report accordingly", async ({
    page,
  }) => {
    await freshApp(page);
    await addNamedState(page, "Interim", "2027-01-01"); // sorts between "Current" and "Target 2028" by date

    // Distinguish "Interim" with an override only it carries, so diffs pick it up specifically.
    await treeItem(page, "Payments").click();
    await page.getByTestId("overrides-toggle").click();
    await page.getByTestId("overrides-state-picker").selectOption({ label: "Interim" });
    await page.getByTestId("override-description").fill("Interim payments variant");
    await page.getByTestId("override-description").blur();

    // Middle (Interim) vs last (Target 2028): both the Interim-only override and the
    // seed's Target-only Web App technology override should show up.
    await page.getByTestId("diff-a").selectOption({ label: "Interim" });
    await page.getByTestId("diff-b").selectOption({ label: "Target 2028" });
    await page.getByTestId("diff-toggle").click();
    const report = page.getByTestId("diff-report");
    await expect(report).toContainText("~ Payments: description");
    await expect(report).toContainText("~ Web App: technology");

    // Switch diff-a to "Current" (first) live, diff-b stays "Target 2028": the default
    // pair — Interim's override no longer applies to either side.
    await page.getByTestId("diff-a").selectOption({ label: "Current" });
    await expect(report).toContainText("~ Web App: technology");
    await expect(report).not.toContainText("Payments");

    // Now diff-b to "Interim" (middle) instead: Payments reappears, Web App does not
    // (the technology override is Target-only).
    await page.getByTestId("diff-b").selectOption({ label: "Interim" });
    await expect(report).toContainText("~ Payments: description");
    await expect(report).not.toContainText("Next.js");
  });

  test("the ▲▼ reorder buttons persist state order across a reload", async ({ page }) => {
    await freshApp(page);
    await addNamedState(page, "Interim", "2027-01-01");

    const chips = page.locator('[data-testid^="time-state-"]');
    await expect(chips).toHaveText(["Current", "Interim", "Target 2028"]);

    await page.getByTestId("states-manage").click();
    await page.getByTestId("state-down-Current").click();
    await page.getByTestId("states-manage").click();
    await expect(chips).toHaveText(["Interim", "Current", "Target 2028"]);

    await page.reload();
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
    await expect(chips).toHaveText(["Interim", "Current", "Target 2028"]);
  });
});

test.describe("TCO scope select", () => {
  test("scoping to a system shows only its subtree rows and subtree totals", async ({ page }) => {
    await freshApp(page);

    await treeItem(page, "Web App").click();
    await openCosts(page);
    await addCost(page, { label: "Web hosting", amount: 12000 });

    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await addCost(page, { label: "Card processing fees", amount: 6000 });

    await page.getByTestId("open-analysis").click();
    await expect(page.getByTestId("tco-table")).toContainText("Payments");

    await page.getByTestId("tco-scope").selectOption({ label: "Booking Engine" });
    const table = page.getByTestId("tco-table");
    await expect(table).toContainText("Web App");
    await expect(table).toContainText("Booking Engine");
    await expect(table).not.toContainText("Payments");
    await expect(page.getByTestId("tco-row")).toHaveCount(2);
    await expect(page.getByTestId("tco-total-annual")).toHaveText("£12,000/yr");
    await expect(page.getByTestId("tco-total")).toHaveText("£60,000");
  });
});

test.describe("⌘K deep search", () => {
  test("finds elements by tag, by documentation text, and by a stencil attribute value", async ({ page }) => {
    await freshApp(page);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("cmdk-input").fill("pci");
    await expect(page.getByTestId("cmdk-result").first()).toContainText("Payments");
    await page.keyboard.press("Escape");

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("cmdk-input").fill("system of record");
    await expect(page.getByTestId("cmdk-result").first()).toContainText("Booking Engine");
    await page.keyboard.press("Escape");

    // Give an agent a "full-auto" autonomy level, then find it by that stencil attribute value.
    await rfNode(page, "Booking Engine").dblclick();
    await page.getByTestId("palette-agent").click();
    await page.getByTestId("attr-autonomyLevel").fill("full-auto");
    await page.getByTestId("attr-autonomyLevel").blur();
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("cmdk-input").fill("full-auto");
    await expect(page.getByTestId("cmdk-result").first()).toContainText("New AI Agent");
  });

  test("a relationship result renders and Enter selects it, showing it in the inspector", async ({ page }) => {
    await freshApp(page);

    await page.keyboard.press("ControlOrMeta+k");
    await page.getByTestId("cmdk-input").fill("takes payment via");
    const result = page.getByTestId("cmdk-result").first();
    await expect(result).toContainText("Relationship");
    await expect(result).toContainText("Booking Engine");
    await expect(result).toContainText("Payments");

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("cmdk")).toHaveCount(0);
    await expect(page.getByTestId("inspector-relationship")).toBeVisible();
    await expect(page.getByTestId("inspector-rel-name")).toHaveValue("takes payment via");
  });
});

test.describe("views list grouping", () => {
  test("the views list groups by kind under headings, landscape before container", async ({ page }) => {
    await freshApp(page);

    await expect(page.getByTestId("view-group-landscape")).toBeVisible();
    await expect(page.getByTestId("view-group-container")).toBeVisible();
    await expect(page.getByTestId("view-Landscape")).toBeVisible();
    await expect(page.getByTestId("view-Booking Engine — containers")).toBeVisible();

    const landscapeHeading = await page.getByTestId("view-group-landscape").boundingBox();
    const containerHeading = await page.getByTestId("view-group-container").boundingBox();
    expect(landscapeHeading!.y).toBeLessThan(containerHeading!.y);
  });
});

test.describe("cost CSV import", () => {
  test("a valid 2-row CSV creates both entries and updates the summary", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "Payments").click();
    await openCosts(page);
    await page.getByTestId("cost-import").click();
    await page
      .getByTestId("cost-import-text")
      .fill(
        "label,category,classification,kind,amount\n" +
          "Cloud hosting,infrastructure,run,recurring,24000\n" +
          "Staff augmentation,people,run,recurring,36000",
      );
    await expect(page.getByTestId("cost-import-errors")).toHaveCount(0);
    await expect(page.getByTestId("cost-import-apply")).toBeEnabled();
    await page.getByTestId("cost-import-apply").click();

    await expect(page.getByTestId("cost-row")).toHaveCount(2);
    await expect(page.getByTestId("costs-summary")).toHaveText("2 entries · £60,000/yr");
  });

  test("a row with an unknown category blocks apply until it is fixed", async ({ page }) => {
    await freshApp(page);
    await canvasNode(page, "CRM").click();
    await openCosts(page);
    await page.getByTestId("cost-import").click();
    await page
      .getByTestId("cost-import-text")
      .fill(
        "label,category,classification,kind,amount\n" +
          "Support,vendor-services,run,recurring,12000\n" +
          "Mystery Cost,not-a-category,run,recurring,1000",
      );

    await expect(page.getByTestId("cost-import-errors")).toContainText('Row 3: Unknown category "not-a-category"');
    await expect(page.getByTestId("cost-import-apply")).toBeDisabled();

    // Fix the bad row's category — the same paste, corrected.
    await page
      .getByTestId("cost-import-text")
      .fill(
        "label,category,classification,kind,amount\n" +
          "Support,vendor-services,run,recurring,12000\n" +
          "Mystery Cost,other,run,recurring,1000",
      );
    await expect(page.getByTestId("cost-import-errors")).toHaveCount(0);
    await expect(page.getByTestId("cost-import-apply")).toBeEnabled();
    await page.getByTestId("cost-import-apply").click();
    await expect(page.getByTestId("cost-row")).toHaveCount(2);
  });
});

/*
 * Chat streaming/persistence and AI stencil creation, below, stub the
 * Anthropic API the same way e2e/ai-chat.spec.ts does (a `client.messages
 * .stream(...)` SSE wire format the SDK's stream accumulator reconstructs
 * into a normal `Message`). That file doesn't export its helpers, so the
 * minimal pieces are mirrored here rather than editing it just for reuse.
 */

interface FixtureContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}
interface FixtureMessage {
  id: string;
  type: string;
  role: string;
  model: string;
  stop_reason: string;
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
  content: FixtureContentBlock[];
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "*",
};

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function toSSE(message: FixtureMessage): string {
  let body = sseEvent("message_start", {
    type: "message_start",
    message: { ...message, content: [], stop_reason: null, stop_sequence: null },
  });
  message.content.forEach((block, index) => {
    if (block.type === "text") {
      body += sseEvent("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      body += sseEvent("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text ?? "" },
      });
    } else if (block.type === "tool_use") {
      body += sseEvent("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      body += sseEvent("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) },
      });
    }
    body += sseEvent("content_block_stop", { type: "content_block_stop", index });
  });
  body += sseEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: message.stop_reason, stop_sequence: message.stop_sequence },
    usage: { output_tokens: message.usage.output_tokens },
  });
  body += sseEvent("message_stop", { type: "message_stop" });
  return body;
}

const FINAL_RESPONSE: FixtureMessage = {
  id: "msg_stub_final",
  type: "message",
  role: "assistant",
  model: "claude-opus-4-8",
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
  content: [{ type: "text", text: "Done." }],
};

const TOOL_USE_RESPONSE: FixtureMessage = {
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

/** A `create_elements` turn whose element carries an `ai-agents/agent` stencil ref with attributes. */
const STENCIL_TOOL_USE_RESPONSE: FixtureMessage = {
  id: "msg_stub_stencil_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-4-8",
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
  content: [
    { type: "text", text: "Queuing a refund agent under Booking Engine." },
    {
      type: "tool_use",
      id: "toolu_s1",
      name: "create_elements",
      input: {
        elements: [
          {
            name: "Refund Agent",
            kind: "container",
            parent: "Booking Engine",
            stencil: { pack: "ai-agents", stencil: "agent", attributes: { autonomyLevel: "approve" } },
          },
        ],
      },
    },
    {
      type: "tool_use",
      id: "toolu_s2",
      name: "place_on_view",
      input: { elements: ["Refund Agent"] },
    },
  ],
};

async function stubAnthropic(page: Page, first: FixtureMessage): Promise<void> {
  const state = { calls: 0 };
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    state.calls += 1;
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "text/event-stream; charset=utf-8" },
      body: toSSE(state.calls === 1 ? first : FINAL_RESPONSE),
    });
  });
}

async function openChatAndAsk(page: Page, message: string): Promise<void> {
  await page.getByTestId("right-tab-chat").click();
  await page.getByTestId("chat-settings").click();
  await page.getByTestId("chat-api-key").fill("sk-ant-test-key");
  await page.getByTestId("chat-settings").click();
  await page.getByTestId("chat-input").fill(message);
  await page.getByTestId("chat-send").click();
}

test.describe("chat streaming, persistence and AI stencil creation", () => {
  test("a queued proposal persists across a reload and can still be applied", async ({ page }) => {
    await freshApp(page);
    // The workspace itself is only persisted to localStorage on its first dispatch
    // (see store.ts's `bump`) — touch something trivial first so element ids are
    // stable across the reload below, the same as any real (already-used) workspace.
    await canvasNode(page, "CRM").click();
    await page.getByTestId("inspector-criticality").selectOption("low");

    await stubAnthropic(page, TOOL_USE_RESPONSE);
    await openChatAndAsk(page, "Add a payments gateway connected to the booking engine over Kafka");
    await expect(page.getByTestId("chat-proposal")).toBeVisible();

    await page.reload();
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
    await page.getByTestId("right-tab-chat").click();
    await expect(page.getByTestId("chat-proposal")).toBeVisible();
    await expect(page.getByTestId("chat-proposal")).toContainText('Create system "Payments Gateway"');

    await page.getByTestId("proposal-apply").click();
    await expect(canvasNode(page, "Payments Gateway")).toBeVisible();
  });

  test("the model select shows claude-opus-4-8 as the default", async ({ page }) => {
    await freshApp(page);
    await page.getByTestId("right-tab-chat").click();
    await page.getByTestId("chat-settings").click();
    await expect(page.getByTestId("chat-model-select")).toHaveValue("claude-opus-4-8");
  });

  test("an AI-created element carrying a stencil ref shows its attributes in the Inspector once applied", async ({
    page,
  }) => {
    await freshApp(page);
    // Drill into the container view first — a container-kind agent can't be placed on the landscape view.
    await rfNode(page, "Booking Engine").dblclick();
    await stubAnthropic(page, STENCIL_TOOL_USE_RESPONSE);
    await openChatAndAsk(page, "Add a refund agent under booking engine with approve autonomy");

    await expect(page.getByTestId("chat-proposal")).toContainText('Create container "Refund Agent" in Booking Engine');
    await page.getByTestId("proposal-apply").click();

    const node = canvasNode(page, "Refund Agent");
    await expect(node).toBeVisible();
    await expect(node.getByTestId("stencil-symbol")).toBeVisible();

    await node.click();
    await page.getByTestId("right-tab-inspector").click();
    await expect(page.getByTestId("stencil-attributes")).toContainText("AI Agent attributes");
    await expect(page.getByTestId("attr-autonomyLevel")).toHaveValue("approve");
  });
});
