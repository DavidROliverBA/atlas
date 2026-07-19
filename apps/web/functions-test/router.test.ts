/**
 * Contract tests for the Atlas model API router
 * (`apps/web/functions/api/v1/[[path]].ts`), run in-process against
 * `onRequest` with an in-memory fake standing in for Supabase — see
 * `support/fake-supabase.ts`. Exercises the real router and the real
 * `@atlas/storage-supabase` adapter end to end (same command bus, same
 * metamodel validation as the UI and AI), just without the network.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { onRequest, __setSupabaseClientFactory } from "../functions/api/v1/[[path]]";
import { FakeSupabase } from "./support/fake-supabase";

const TOKEN = "test-token";

interface CallOptions {
  /** `null` omits the Authorization header entirely; defaults to the service token. */
  token?: string | null;
  body?: unknown;
  query?: Record<string, string>;
}

function makeEnv() {
  return { ATLAS_API_TOKEN: TOKEN, SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key" };
}

async function call(method: string, segments: string[], opts: CallOptions = {}): Promise<Response> {
  const url = new URL(`https://example.com/api/v1/${segments.join("/")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const token = opts.token === undefined ? TOKEN : opts.token;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return onRequest({ request, env: makeEnv(), params: { path: segments } });
}

async function createElement(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await call("POST", ["elements"], { body });
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, unknown>;
}

let fake: FakeSupabase;

beforeEach(() => {
  fake = new FakeSupabase();
  __setSupabaseClientFactory(() => fake as unknown as SupabaseClient);
});

afterEach(() => {
  __setSupabaseClientFactory(undefined);
});

describe("auth", () => {
  it("401s a protected route with no token", async () => {
    const res = await call("GET", ["elements"], { token: null });
    expect(res.status).toBe(401);
  });

  it("200s a protected route with the ATLAS_API_TOKEN service token", async () => {
    const res = await call("GET", []);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { elements: unknown[] };
    expect(Array.isArray(body.elements)).toBe(true);
  });
});

describe("elements", () => {
  it("round-trips create, read, update, delete", async () => {
    const created = await createElement({ kind: "system", name: "Payments Hub" });
    expect(created.kind).toBe("system");
    expect(created.name).toBe("Payments Hub");
    expect(typeof created.id).toBe("string");

    const got = await call("GET", ["elements", created.id as string]);
    expect(got.status).toBe(200);
    expect(((await got.json()) as { name: string }).name).toBe("Payments Hub");

    const patched = await call("PATCH", ["elements", created.id as string], { body: { name: "Payments Core" } });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { name: string }).name).toBe("Payments Core");

    const deleted = await call("DELETE", ["elements", created.id as string]);
    expect(deleted.status).toBe(204);

    const goneRes = await call("GET", ["elements", created.id as string]);
    expect(goneRes.status).toBe(404);
  });

  it("assigns server-side ids to cost entries that arrive without one", async () => {
    const created = await createElement({
      kind: "system",
      name: "Billing",
      costs: [
        { label: "Enterprise licence", category: "licences", classification: "run", kind: "recurring", amount: 1200 },
      ],
    });
    const costs = created.costs as Array<{ id: string; label: string }>;
    expect(costs).toHaveLength(1);
    expect(typeof costs[0]!.id).toBe("string");
    expect(costs[0]!.id.length).toBeGreaterThan(0);
    expect(costs[0]!.label).toBe("Enterprise licence");
  });

  it("rejects a metamodel violation with 400 and a descriptive message", async () => {
    // A Container may only live inside a Software System — top-level is illegal.
    const res = await call("POST", ["elements"], { body: { kind: "container", name: "Bad Container" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("cannot live");
  });

  it("404s a missing element", async () => {
    const res = await call("GET", ["elements", "does-not-exist"]);
    expect(res.status).toBe(404);
  });

  it("rejects a stencil ref with attributes outside the pack schema (same validation as the UI)", async () => {
    await call("POST", ["elements"], { body: { kind: "system", name: "Stencil Host" } });
    await call("POST", ["elements"], {
      body: { kind: "container", name: "Stencil Container", parentName: "Stencil Host" },
    });
    const res = await call("POST", ["elements"], {
      body: {
        kind: "component",
        name: "Bad Stencil",
        parentName: "Stencil Container",
        stencil: { pack: "aws", stencil: "ec2", attributes: { notAField: true } },
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("additional properties");
  });
});

describe("lint", () => {
  it("GET /lint returns an array", async () => {
    const res = await call("GET", ["lint"]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});

describe("connections", () => {
  it("happy path returns the ego network around the element", async () => {
    const a = await createElement({ kind: "system", name: "Hub" });
    const b = await createElement({ kind: "system", name: "Satellite" });
    await call("POST", ["relationships"], {
      body: { sourceId: a.id, targetId: b.id, name: "calls" },
    });

    const res = await call("GET", ["elements", a.id as string, "connections"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { center: string; nodes: unknown[]; edges: unknown[] };
    expect(body.center).toBe(a.id);
    expect(body.nodes.length).toBeGreaterThanOrEqual(2);
    expect(body.edges).toHaveLength(1);
  });

  it("400s an out-of-range depth", async () => {
    const a = await createElement({ kind: "system", name: "Depth Probe" });
    const res = await call("GET", ["elements", a.id as string, "connections"], { query: { depth: "9" } });
    expect(res.status).toBe(400);
  });

  it("400s an unknown direction", async () => {
    const a = await createElement({ kind: "system", name: "Direction Probe" });
    const res = await call("GET", ["elements", a.id as string, "connections"], {
      query: { direction: "sideways" },
    });
    expect(res.status).toBe(400);
  });

  it("404s connections for an unknown element", async () => {
    const res = await call("GET", ["elements", "does-not-exist", "connections"]);
    expect(res.status).toBe(404);
  });
});

describe("views export", () => {
  async function createView(): Promise<Record<string, unknown>> {
    const res = await call("POST", ["views"], { body: { kind: "landscape", name: "Estate" } });
    expect(res.status).toBe(201);
    return (await res.json()) as Record<string, unknown>;
  }

  it("exports mermaid", async () => {
    const view = await createView();
    const res = await call("GET", ["views", view.id as string, "export"], { query: { format: "mermaid" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("exports plantuml", async () => {
    const view = await createView();
    const res = await call("GET", ["views", view.id as string, "export"], { query: { format: "plantuml" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("exports svg", async () => {
    const view = await createView();
    const res = await call("GET", ["views", view.id as string, "export"], { query: { format: "svg" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("400s an unknown format", async () => {
    const view = await createView();
    const res = await call("GET", ["views", view.id as string, "export"], { query: { format: "docx" } });
    expect(res.status).toBe(400);
  });
});

describe("commands", () => {
  it("GET /commands/schema returns every command type", async () => {
    const res = await call("GET", ["commands", "schema"]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        "batch",
        "createElement",
        "createRelationship",
        "createState",
        "createView",
        "deleteElement",
        "deleteRelationship",
        "deleteState",
        "deleteView",
        "placeOnView",
        "removeFromView",
        "updateElement",
        "updatePlacement",
        "updateRelationship",
        "updateState",
        "updateView",
        "updateWorkspaceMeta",
      ].sort(),
    );
  });

  it("POST /commands is atomic — an invalid second command rolls back the first", async () => {
    const res = await call("POST", ["commands"], {
      body: {
        commands: [
          { type: "createElement", element: { id: "01ATOMICOKAAAAAAAAAAAAAAAA", kind: "system", name: "Atomic A" } },
          {
            type: "createElement",
            // Illegal: a Container cannot live at the top level.
            element: { id: "01ATOMICBADAAAAAAAAAAAAAAA", kind: "container", name: "Atomic B", parentId: null },
          },
        ],
      },
    });
    expect(res.status).toBe(400);

    const check = await call("GET", ["elements"], { query: { name: "Atomic A" } });
    expect(await check.json()).toHaveLength(0);
  });
});

describe("routing", () => {
  it("404s an unknown route", async () => {
    const res = await call("GET", ["not-a-real-resource"]);
    expect(res.status).toBe(404);
  });
});
