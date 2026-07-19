/**
 * Export → import round-trip proof for the Atlas REST API (`/api/v1`).
 *
 * Builds a maximum-fidelity workspace (every optional field on every entity
 * type populated at least once) through `POST /commands` with explicit
 * ULIDs, exports it via `GET /workspace`, wipes the workspace through the
 * same API, reconstructs it from the exported snapshot alone, and asserts
 * the reconstruction is indistinguishable from the original — both as plain
 * data and through `@atlas/core`'s byte-deterministic file serialiser
 * (`workspaceToFiles`), which is the strongest oracle available (§3.8A).
 *
 * Harness: same fake-Supabase-backed `onRequest` contract-test setup as
 * `router.test.ts` — see `support/fake-supabase.ts` for what it does and
 * does not model.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CommandBus,
  Workspace,
  seededUlidFactory,
  workspaceToFiles,
  type Command,
  type Element,
  type NamedState,
  type Relationship,
  type Ulid,
  type View,
  type WorkspaceData,
} from "@atlas/core";
import { onRequest, __setSupabaseClientFactory } from "../functions/api/v1/[[path]]";
import { FakeSupabase } from "./support/fake-supabase";

const TOKEN = "test-token";

function makeEnv() {
  return { ATLAS_API_TOKEN: TOKEN, SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key" };
}

interface CallOptions {
  body?: unknown;
  query?: Record<string, string>;
}

async function call(method: string, segments: string[], opts: CallOptions = {}): Promise<Response> {
  const url = new URL(`https://example.com/api/v1/${segments.join("/")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return onRequest({ request, env: makeEnv(), params: { path: segments } });
}

/** POST /commands as a single atomic batch; throws with the server's message on failure. */
async function postCommands(commands: Command[]): Promise<WorkspaceData> {
  const res = await call("POST", ["commands"], { body: { commands } });
  if (res.status !== 201) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`POST /commands failed (${res.status}): ${body.error ?? "no message"}`);
  }
  return (await res.json()) as WorkspaceData;
}

async function getWorkspace(): Promise<WorkspaceData> {
  const res = await call("GET", ["workspace"]);
  expect(res.status).toBe(200);
  return (await res.json()) as WorkspaceData;
}

/**
 * Build a maximum-fidelity workspace snapshot: every optional field on every
 * entity type is populated at least once. This is the fixture both round-
 * trip tests reconstruct from — never mutated after creation, so both tests
 * observe the exact same intended shape.
 */
function buildTargetData(seed: number): WorkspaceData {
  const ids = seededUlidFactory(seed);
  const next = () => ids.next();

  const stateCurrent: Ulid = next();
  const stateTarget: Ulid = next();
  const states: NamedState[] = [
    { id: stateCurrent, name: "Current", date: "2026-01-01", description: "Baseline estate" },
    { id: stateTarget, name: "Target 2028", date: "2028-01-01", description: "Future estate" },
  ];

  const sysId: Ulid = next();
  const containerId: Ulid = next();
  const componentId: Ulid = next();
  const groupId: Ulid = next();
  const personId: Ulid = next();
  const cost1Id: Ulid = next();
  const cost2Id: Ulid = next();

  // The maximum-fidelity element: every optional Element field populated.
  const system: Element = {
    id: sysId,
    kind: "system",
    name: "Core Platform",
    parentId: null,
    description: "Central platform",
    documentation: "# Docs\n\nSomething **important**.",
    technology: ["Kotlin", "Postgres"],
    owners: ["Platform Team"],
    team: "Platform Guild",
    status: "live",
    criticality: "critical",
    tags: ["core", "tier-1"],
    links: [{ title: "Runbook", url: "https://example.com/runbook" }],
    properties: { env: "prod", region: "eu-west-1" },
    color: "#112233",
    costs: [
      {
        id: cost1Id,
        label: "Support",
        category: "licences",
        classification: "run",
        kind: "recurring",
        amount: 12000,
        currency: "GBP",
        period: "monthly",
        confidence: "quoted",
        validFrom: "2026-01-01",
        states: [stateCurrent],
      },
      {
        id: cost2Id,
        label: "Migration",
        category: "change",
        classification: "acquire",
        kind: "one-off",
        amount: 300000,
        currency: "USD",
        amortiseYears: 5,
        confidence: "estimate",
        validFrom: "2027-01-01",
        validTo: "2029-01-01",
        states: [stateTarget],
      },
    ],
    stencil: { pack: "aws", stencil: "ec2", attributes: { region: "eu-west-1", accountId: "123456789012" } },
    temporal: { validFrom: "2020-01-01", validTo: "2035-12-31", states: [stateCurrent, stateTarget] },
    stateOverrides: {
      [stateCurrent]: { name: "Core Platform (current)", technology: ["Kotlin"], status: "live", tags: ["core"] },
      [stateTarget]: { status: "deprecated" },
    },
  };

  const container: Element = {
    id: containerId,
    kind: "container",
    name: "API Layer",
    parentId: sysId,
    description: "API layer",
    technology: ["Node.js"],
    tags: ["internal"],
  };

  const component: Element = {
    id: componentId,
    kind: "component",
    name: "Auth Module",
    parentId: containerId,
    description: "Authentication/authorisation",
    tags: ["security"],
  };

  const group: Element = {
    id: groupId,
    kind: "group",
    name: "Boundary",
    parentId: null,
    tags: ["boundary"],
  };

  const person: Element = {
    id: personId,
    kind: "person",
    name: "Alice",
    parentId: null,
    description: "Stakeholder",
    tags: ["external"],
  };

  const rel1Id: Ulid = next();
  const rel2Id: Ulid = next();

  const rel1: Relationship = {
    id: rel1Id,
    sourceId: personId,
    targetId: sysId,
    name: "uses",
    description: "End user access",
    technology: ["HTTPS"],
    direction: "bidirectional",
    tags: ["primary"],
    properties: { criticality: "high" },
    color: "#ff0000",
    temporal: { validFrom: "2021-01-01", states: [stateCurrent] },
  };

  const rel2: Relationship = {
    id: rel2Id,
    sourceId: sysId,
    targetId: containerId,
    name: "delegates to",
    description: "Internal call",
    technology: ["gRPC"],
    tags: ["internal"],
    color: "#0000ff",
    temporal: { validTo: "2025-01-01" },
  };

  const viewId: Ulid = next();
  const view: View = {
    id: viewId,
    kind: "landscape",
    name: "Estate",
    scopeId: null,
    description: "Landscape view of the estate",
    renderMode: "isometric",
    placements: [
      { elementId: sysId, x: 0, y: 0, width: 14, height: 8 },
      { elementId: personId, x: 20, y: 0 },
    ],
    hiddenRelationshipIds: [rel2Id],
    edgeAnchors: { [rel1Id]: { source: "r1", target: "l1" } },
  };

  return {
    meta: {
      formatVersion: 1,
      name: "Round-trip Estate",
      description: "Maximum-fidelity fixture for the export/import round-trip proof",
      stencilPacks: ["c4-core@1", "aws@1"],
    },
    elements: [system, container, component, group, person],
    relationships: [rel1, rel2],
    views: [view],
    states,
  };
}

/**
 * Map a WorkspaceData snapshot to the command batch that recreates it —
 * "the documented API import path": explicit-id `create*` commands plus an
 * explicit `updateWorkspaceMeta`. Order matters: states before elements
 * (temporal/cost state references validate at creation), elements in
 * parent-before-child order (containment validates at creation), then
 * relationships (endpoint + temporal-state validation), then views.
 */
function snapshotToCommands(data: WorkspaceData): Command[] {
  const commands: Command[] = [];

  for (const s of data.states) commands.push({ type: "createState", state: s });

  const remaining = new Map(data.elements.map((e) => [e.id, e]));
  const placed = new Set<Ulid>();
  while (remaining.size) {
    const ready = [...remaining.values()].find((e) => e.parentId === null || placed.has(e.parentId));
    if (!ready) throw new Error("snapshotToCommands: containment cycle or missing parent in elements");
    commands.push({ type: "createElement", element: ready });
    placed.add(ready.id);
    remaining.delete(ready.id);
  }

  for (const r of data.relationships) commands.push({ type: "createRelationship", relationship: r });
  for (const v of data.views) commands.push({ type: "createView", view: v });

  commands.push({
    type: "updateWorkspaceMeta",
    changes: { name: data.meta.name, description: data.meta.description, stencilPacks: data.meta.stencilPacks },
  });

  return commands;
}

/** Children-before-parents delete order — `deleteElement` refuses to delete an element with children. */
function leafFirstElementIds(elements: Element[]): Ulid[] {
  const remaining = new Map(elements.map((e) => [e.id, e]));
  const order: Ulid[] = [];
  while (remaining.size) {
    const hasChildren = (id: Ulid) => [...remaining.values()].some((e) => e.parentId === id);
    const leaves = [...remaining.values()].filter((e) => !hasChildren(e.id));
    if (!leaves.length) throw new Error("leafFirstElementIds: containment cycle");
    for (const e of leaves) {
      order.push(e.id);
      remaining.delete(e.id);
    }
  }
  return order;
}

/**
 * Wipe every model object via the API. `deleteElement` cascades relationships
 * touching the element and its placements on every view (verified by reading
 * `packages/core/src/commands/bus.ts`'s `deleteElement`/`cascadeDeleteRelationship`
 * cases), so explicit `deleteRelationship` commands are unnecessary here —
 * deleting elements leaf-first, then views, then states, is sufficient and
 * is exercised as a single atomic batch.
 */
async function wipeWorkspace(data: WorkspaceData): Promise<void> {
  const commands: Command[] = [
    ...leafFirstElementIds(data.elements).map((id): Command => ({ type: "deleteElement", id })),
    ...data.views.map((v): Command => ({ type: "deleteView", id: v.id })),
    ...data.states.map((s): Command => ({ type: "deleteState", id: s.id })),
  ];
  if (commands.length) await postCommands(commands);
}

let fake: FakeSupabase;

beforeEach(() => {
  fake = new FakeSupabase();
  __setSupabaseClientFactory(() => fake as unknown as SupabaseClient);
});

afterEach(() => {
  __setSupabaseClientFactory(undefined);
});

describe("API export → import round-trip", () => {
  it("reconstructs a maximum-fidelity workspace from its own export byte-for-byte", async () => {
    const target = buildTargetData(1);

    // Build.
    await postCommands(snapshotToCommands(target));

    // Sanity: the API's own view of what it just built matches our fixture's
    // shape (fails loudly, with the field name, if any command silently
    // dropped or coerced something on the way in).
    const built = await getWorkspace();
    expect(built.elements).toHaveLength(target.elements.length);
    expect(built.relationships).toHaveLength(target.relationships.length);
    expect(built.views).toHaveLength(target.views.length);
    expect(built.states).toHaveLength(target.states.length);

    // EXPORT.
    const snapshotA = await getWorkspace();

    // WIPE — delete everything via the API (leaf-first elements, then
    // views, then states; deleteElement cascades relationships/placements).
    await wipeWorkspace(snapshotA);
    const wiped = await getWorkspace();
    expect(wiped.elements).toHaveLength(0);
    expect(wiped.relationships).toHaveLength(0);
    expect(wiped.views).toHaveLength(0);
    expect(wiped.states).toHaveLength(0);

    // IMPORT — reconstruct from snapshot A alone (the documented API import
    // path: explicit-id create commands + updateWorkspaceMeta).
    await postCommands(snapshotToCommands(snapshotA));
    const snapshotB = await getWorkspace();

    // Oracle #1: plain deep-equality of the two snapshots.
    expect(snapshotB).toEqual(snapshotA);

    // Oracle #2 (strongest): byte-identical canonical file maps via
    // @atlas/core's deterministic serialiser.
    const filesA = workspaceToFiles(Workspace.fromData(snapshotA));
    const filesB = workspaceToFiles(Workspace.fromData(snapshotB));
    expect(Object.fromEntries(filesB)).toEqual(Object.fromEntries(filesA));
  });

  it("the API-built workspace serialises identically to the same commands run directly through CommandBus", async () => {
    // Guards against the API/storage-adapter layer (HTTP JSON round-trip,
    // Supabase row mapping in @atlas/storage-supabase) mutating anything
    // that a direct, no-network CommandBus run wouldn't.
    const target = buildTargetData(2);
    const commands = snapshotToCommands(target);

    await postCommands(commands);
    const snapshotA = await getWorkspace();

    const wsDirect = new Workspace();
    const busDirect = new CommandBus(wsDirect);
    busDirect.dispatch({ type: "batch", commands });

    const filesFromApi = workspaceToFiles(Workspace.fromData(snapshotA));
    const filesFromDirectBus = workspaceToFiles(wsDirect);
    expect(Object.fromEntries(filesFromApi)).toEqual(Object.fromEntries(filesFromDirectBus));
  });
});
