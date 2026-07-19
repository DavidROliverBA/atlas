import { expect, test, type Page } from "@playwright/test";
import { canvasNode, connectNodes, freshApp, rfNode, settle, treeItem } from "./helpers";

/**
 * CRUD round-trip audit between the model API and the UI, in shared-database
 * mode. The API is stubbed in-memory but applies the same commands the real
 * endpoint does, so pushes and pulls behave like production.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ulid = (n: number): string => {
  let s = "";
  let v = n;
  for (let i = 0; i < 24; i++) {
    s = ALPHABET[v % 32] + s;
    v = Math.floor(v / 32);
  }
  return `01${s}`;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Snap = {
  meta: any;
  elements: any[];
  relationships: any[];
  views: any[];
  states: any[];
};

function buildSnapshot(): { snap: Snap; ids: Record<string, string> } {
  let n = 1000;
  const id = () => ulid(n++);
  const ids = {
    paymentsHub: id(),
    billingApi: id(),
    fraudEngine: id(),
    dataLake: id(),
    screensRel: id(),
    landscape: id(),
  };
  const snap: Snap = {
    meta: { formatVersion: 1, name: "Shared estate" },
    elements: [
      { id: ids.paymentsHub, kind: "system", name: "Payments Hub", parentId: null, tags: ["api-made"] },
      { id: ids.billingApi, kind: "container", name: "Billing API", parentId: ids.paymentsHub, technology: ["Go"] },
      { id: ids.fraudEngine, kind: "system", name: "Fraud Engine", parentId: null },
      { id: ids.dataLake, kind: "system", name: "Data Lake", parentId: null },
    ],
    relationships: [
      { id: ids.screensRel, sourceId: ids.paymentsHub, targetId: ids.fraudEngine, name: "screens with" },
    ],
    views: [
      {
        id: ids.landscape,
        kind: "landscape",
        name: "DB landscape",
        scopeId: null,
        placements: [
          { elementId: ids.paymentsHub, x: 0, y: 0 },
          { elementId: ids.fraudEngine, x: 14, y: 0 },
        ],
      },
    ],
    states: [],
  };
  return { snap, ids };
}

/** Apply a command with the same semantics as the real API (subset used by the UI). */
function apply(snap: Snap, cmd: any): void {
  switch (cmd.type) {
    case "batch":
      for (const sub of cmd.commands) apply(snap, sub);
      return;
    case "createElement":
      snap.elements.push(structuredClone(cmd.element));
      return;
    case "updateElement": {
      const el = snap.elements.find((e) => e.id === cmd.id);
      for (const [k, v] of Object.entries(cmd.changes)) {
        if (v === null) delete el[k];
        else el[k] = v;
      }
      return;
    }
    case "deleteElement":
      snap.elements = snap.elements.filter((e) => e.id !== cmd.id);
      snap.relationships = snap.relationships.filter(
        (r) => r.sourceId !== cmd.id && r.targetId !== cmd.id,
      );
      for (const v of snap.views) v.placements = v.placements.filter((p: any) => p.elementId !== cmd.id);
      return;
    case "createRelationship":
      snap.relationships.push(structuredClone(cmd.relationship));
      return;
    case "updateRelationship": {
      const rel = snap.relationships.find((r) => r.id === cmd.id);
      for (const [k, v] of Object.entries(cmd.changes)) {
        if (v === null) delete rel[k];
        else rel[k] = v;
      }
      return;
    }
    case "deleteRelationship":
      snap.relationships = snap.relationships.filter((r) => r.id !== cmd.id);
      for (const v of snap.views) if (v.edgeAnchors) delete v.edgeAnchors[cmd.id];
      return;
    case "createView":
      snap.views.push(structuredClone(cmd.view));
      return;
    case "updateView": {
      const view = snap.views.find((v) => v.id === cmd.id);
      for (const [k, v] of Object.entries(cmd.changes)) {
        if (v === null) delete view[k];
        else view[k] = v;
      }
      return;
    }
    case "deleteView":
      snap.views = snap.views.filter((v) => v.id !== cmd.id);
      return;
    case "placeOnView":
      snap.views.find((v) => v.id === cmd.viewId)?.placements.push(structuredClone(cmd.placement));
      return;
    case "updatePlacement": {
      const placement = snap.views
        .find((v) => v.id === cmd.viewId)
        ?.placements.find((p: any) => p.elementId === cmd.elementId);
      Object.assign(placement, cmd.changes);
      return;
    }
    case "removeFromView": {
      const view = snap.views.find((v) => v.id === cmd.viewId);
      view.placements = view.placements.filter((p: any) => p.elementId !== cmd.elementId);
      return;
    }
    case "updateWorkspaceMeta":
      Object.assign(snap.meta, cmd.changes);
      return;
    default:
      throw new Error(`stub cannot apply ${cmd.type}`);
  }
}

interface Stub {
  snap: Snap;
  ids: Record<string, string>;
  pushed: any[];
  /** When true, the /workspace route fails so tests can simulate an outage. */
  failWorkspace: boolean;
}

async function connectDbMode(page: Page): Promise<Stub> {
  const { snap, ids } = buildSnapshot();
  const stub: Stub = { snap, ids, pushed: [], failWorkspace: false };

  await page.route("**/api/v1/workspace*", (route) => {
    if (stub.failWorkspace) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "database unreachable" }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stub.snap) });
  });
  await page.route("**/api/v1/commands", (route) => {
    const body = route.request().postDataJSON() as { commands: any[] };
    for (const cmd of body.commands) {
      stub.pushed.push(cmd);
      apply(stub.snap, cmd);
    }
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stub.snap) });
  });

  await page.addInitScript(() => localStorage.setItem("atlas.api.token", "test-token"));
  await freshApp(page);
  await page.getByTestId("workspace-source").selectOption("db");
  await expect(page.getByTestId("workspace-name")).toHaveText("Shared estate");
  return stub;
}

const pushedTypes = (stub: Stub): string[] =>
  stub.pushed.flatMap(function flat(c): string[] {
    return c.type === "batch" ? c.commands.flatMap(flat) : [c.type];
  });

test.describe("shared-database round trips (API ↔ UI)", () => {
  test("API-created artefacts load into the UI: canvas, tree, hierarchy, relationships", async ({ page }) => {
    await connectDbMode(page);

    await expect(canvasNode(page, "Payments Hub")).toBeVisible();
    await expect(canvasNode(page, "Fraud Engine")).toBeVisible();
    await expect(page.getByText("screens with")).toBeVisible();
    // Unplaced element is in the model tree (with orphan marker), nested child too.
    await expect(treeItem(page, "Data Lake")).toBeVisible();
    await expect(treeItem(page, "Billing API")).toBeVisible();
  });

  test("API-side changes appear in the UI on sync; removals clear placements and selection", async ({ page }) => {
    const stub = await connectDbMode(page);

    // Another client adds an element + placement, renames one, and deletes one.
    const newId = ulid(9001);
    apply(stub.snap, {
      type: "batch",
      commands: [
        { type: "createElement", element: { id: newId, kind: "system", name: "Ledger", parentId: null } },
        { type: "placeOnView", viewId: stub.ids.landscape, placement: { elementId: newId, x: 28, y: 8 } },
        { type: "updateElement", id: stub.ids.fraudEngine, changes: { name: "Fraud Screening" } },
      ],
    });
    await canvasNode(page, "Payments Hub").click(); // select something that will survive

    await page.getByTestId("db-sync").click();
    await expect(canvasNode(page, "Ledger")).toBeVisible();
    await expect(canvasNode(page, "Fraud Screening")).toBeVisible();
    await expect(canvasNode(page, "Fraud Engine")).toHaveCount(0);

    // Now select Ledger, delete it API-side, sync: node gone, inspector cleared, no crash.
    await canvasNode(page, "Ledger").click();
    apply(stub.snap, { type: "deleteElement", id: newId });
    await page.getByTestId("db-sync").click();
    await expect(canvasNode(page, "Ledger")).toHaveCount(0);
    await expect(page.getByTestId("inspector-empty")).toBeVisible();
  });

  test("UI create/update/delete pushes to the API and stays consistent after sync", async ({ page }) => {
    const stub = await connectDbMode(page);
    page.on("dialog", (d) => d.accept());

    // Create via palette → createElement + placeOnView pushed and applied.
    await page.getByTestId("palette-system").click();
    await expect(canvasNode(page, "New Software System")).toBeVisible();
    expect(pushedTypes(stub)).toEqual(expect.arrayContaining(["createElement", "placeOnView"]));
    expect(stub.snap.elements.some((e) => e.name === "New Software System")).toBe(true);

    // Update via inspector → updateElement pushed.
    await page.getByTestId("inspector-name").fill("Loyalty Service");
    await page.getByTestId("inspector-name").press("Enter");
    expect(stub.snap.elements.some((e) => e.name === "Loyalty Service")).toBe(true);

    // Remove from view only → removeFromView pushed; element stays in DB.
    await page.keyboard.press("Escape");
    await canvasNode(page, "Loyalty Service").click();
    await page.getByTestId("remove-from-view").click();
    expect(pushedTypes(stub)).toContain("removeFromView");
    expect(stub.snap.elements.some((e) => e.name === "Loyalty Service")).toBe(true);

    // Delete from model → deleteElement pushed; gone from DB.
    await treeItem(page, "Loyalty Service").click();
    await page.getByTestId("delete-from-model").click();
    await expect(treeItem(page, "Loyalty Service")).toHaveCount(0);
    expect(stub.snap.elements.some((e) => e.name === "Loyalty Service")).toBe(false);

    // Undo → the inverse (recreate) is pushed too; DB has it back.
    await page.getByTestId("undo").click();
    await expect(treeItem(page, "Loyalty Service")).toBeVisible();
    expect(stub.snap.elements.some((e) => e.name === "Loyalty Service")).toBe(true);

    // A sync after all this is a no-op: local and DB agree.
    await page.getByTestId("db-sync").click();
    await expect(treeItem(page, "Loyalty Service")).toBeVisible();
  });

  test("DB artefacts go onto existing diagrams, and drill-down creates new diagrams in the DB", async ({ page }) => {
    const stub = await connectDbMode(page);

    // Place the unplaced Data Lake on the existing DB landscape from the tree.
    await treeItem(page, "Data Lake").hover();
    await page.getByTestId("place-Data Lake").click();
    await expect(canvasNode(page, "Data Lake")).toBeVisible();
    const landscape = stub.snap.views.find((v) => v.id === stub.ids.landscape)!;
    expect(landscape.placements.some((p: any) => p.elementId === stub.ids.dataLake)).toBe(true);

    // Drill into Payments Hub (has the Billing API child) → a new container view is created and pushed.
    await rfNode(page, "Payments Hub").dblclick();
    await expect(canvasNode(page, "Billing API")).toBeVisible();
    expect(pushedTypes(stub)).toContain("createView");
    expect(stub.snap.views.some((v) => v.kind === "container" && v.scopeId === stub.ids.paymentsHub)).toBe(true);
  });

  test("relationships: create by port drag, edit, delete — all pushed", async ({ page }) => {
    const stub = await connectDbMode(page);
    await settle(page);

    await connectNodes(page, "Fraud Engine", "Payments Hub", "b2", "t2");
    await expect(page.getByTestId("inspector-relationship")).toBeVisible();
    expect(stub.snap.relationships).toHaveLength(2);
    // Port pinning travelled with it.
    expect(pushedTypes(stub)).toContain("updateView");

    await page.getByTestId("inspector-rel-name").fill("alerts");
    await page.getByTestId("inspector-rel-name").blur();
    expect(stub.snap.relationships.some((r) => r.name === "alerts")).toBe(true);

    await page.getByTestId("delete-relationship").click();
    expect(stub.snap.relationships).toHaveLength(1);
  });

  test("outage handling: transient toasts for isolated failures, persistent banner after 3 in a row, clears on recovery", async ({
    page,
  }) => {
    const stub = await connectDbMode(page);

    // A single sync failure behaves as before: a dismissable toast, no banner.
    stub.failWorkspace = true;
    await page.getByTestId("db-sync").click();
    await expect(page.getByTestId("toast-error")).toBeVisible();
    await expect(page.getByTestId("db-outage-banner")).toHaveCount(0);
    await page.getByTestId("toast-error").click(); // dismiss so it doesn't mask later assertions

    // A second consecutive failure: still just a toast, still no banner.
    await page.getByTestId("db-sync").click();
    await expect(page.getByTestId("toast-error")).toBeVisible();
    await expect(page.getByTestId("db-outage-banner")).toHaveCount(0);

    // Third consecutive failure crosses the threshold: persistent amber banner.
    await page.getByTestId("db-sync").click();
    await expect(page.getByTestId("db-outage-banner")).toBeVisible();
    await expect(page.getByTestId("db-outage-banner")).toHaveText("Shared database unreachable — retrying…");

    // The banner doesn't auto-dismiss like a toast does.
    await page.waitForTimeout(300);
    await expect(page.getByTestId("db-outage-banner")).toBeVisible();

    // First success afterwards clears the banner (and, implicitly, the counter).
    stub.failWorkspace = false;
    await page.getByTestId("db-sync").click();
    await expect(page.getByTestId("db-outage-banner")).toHaveCount(0);
  });

  test("switching back to Local restores the untouched browser workspace", async ({ page }) => {
    await connectDbMode(page);
    await page.getByTestId("palette-system").click(); // mutate the DB copy
    await page.getByTestId("workspace-source").selectOption("local");

    await expect(page.getByTestId("workspace-name")).toHaveText("Demo estate");
    await expect(canvasNode(page, "Booking Engine")).toBeVisible();
    await expect(canvasNode(page, "Payments Hub")).toHaveCount(0);
    await expect(treeItem(page, "New Software System")).toHaveCount(0);
  });
});
