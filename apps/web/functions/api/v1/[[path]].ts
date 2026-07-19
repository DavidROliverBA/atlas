/**
 * Atlas model API (v1) — REST over the workspace database.
 *
 * Every mutation loads the workspace, dispatches commands through the same
 * @atlas/core CommandBus the UI and AI use (identical metamodel validation),
 * and persists the result via @atlas/storage-supabase. So anything created
 * here is immediately valid model data, ready to place on diagrams.
 *
 * Auth: `Authorization: Bearer <token>` (or `x-api-key`) where token is a
 * GitHub-SSO Supabase session token or the ATLAS_API_TOKEN service token.
 * Spec: GET /api/v1/openapi.json (public) · Swagger UI: /api/docs.
 */

import {
  CommandBus,
  Workspace,
  checkIntegrity,
  WorkspaceLoadError,
  ulidFactory,
  egoNetwork,
  lintWorkspace,
  toMermaidC4,
  toPlantUmlC4,
  toSvg,
  type Command,
  type CostEntry,
  type DirectionFilter,
  type Element,
  type Relationship,
  type NamedState,
  type Ulid,
  type View,
  type WorkspaceData,
} from "@atlas/core";
import { builtinRegistry } from "@atlas/stencils";
import { RevisionConflictError, SupabaseStorageAdapter } from "@atlas/storage-supabase";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { openapiSpec, commandSchemas } from "./openapi-spec";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";
import { checkRateLimit, hashToken, rateLimitFromEnv } from "../ratelimit";

export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

const stencilRegistry = builtinRegistry();

/** HTTP methods that change stored state — everything else is safe for the read-only token. */
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Requests/minute for the model API when env doesn't override it — see `../ratelimit.ts`. */
const DEFAULT_API_RATE_LIMIT = 120;

interface Env {
  ATLAS_API_TOKEN?: string;
  /** Presenting this token grants GET/HEAD only — any mutating method gets 403. */
  ATLAS_API_TOKEN_READONLY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Comma-separated GitHub usernames allowed to write. Unset = any signed-in user. */
  ATLAS_ALLOWED_GITHUB?: string;
  /** Requests/minute per token before this API returns 429. `"0"` disables. Default 120. */
  ATLAS_RATE_LIMIT_API?: string;
}

interface Ctx {
  request: Request;
  env: Env;
  params: { path?: string[] };
}

const jsonBase = (status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...extraHeaders },
  });

/** Token presented in `x-api-key` or `Authorization: Bearer <token>` — empty string if neither is set. */
const extractToken = (request: Request): string =>
  request.headers.get("x-api-key") ??
  (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

/** Strong validator for a workspace snapshot at a given storage revision. */
const etagFor = (revision: number): string => `"r${revision}"`;

/** True if the client's `If-None-Match` already matches this revision's ETag. */
const isNotModified = (request: Request, etag: string): boolean => {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header === "*" || header.split(",").some((candidate) => candidate.trim() === etag);
};

async function authorised(
  request: Request,
  env: Env,
): Promise<{ ok: boolean; status: number; message?: string; readOnly?: boolean }> {
  const token = extractToken(request);
  if (!token) return { ok: false, status: 401, message: "Missing token" };
  if (env.ATLAS_API_TOKEN && token === env.ATLAS_API_TOKEN) return { ok: true, status: 200 };
  if (env.ATLAS_API_TOKEN_READONLY && token === env.ATLAS_API_TOKEN_READONLY) {
    return { ok: true, status: 200, readOnly: true };
  }

  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
  });
  if (!who.ok) {
    return { ok: false, status: 401, message: "Invalid token — sign in with GitHub or use the service token" };
  }
  // Optional allow-list: only named GitHub accounts may use the API.
  const allowed = env.ATLAS_ALLOWED_GITHUB?.split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);
  if (allowed?.length) {
    const user = (await who.json()) as { user_metadata?: { user_name?: string } };
    const username = user.user_metadata?.user_name?.toLowerCase();
    if (!username || !allowed.includes(username)) {
      return { ok: false, status: 403, message: "This GitHub account is not authorised for the Atlas workspace" };
    }
  }
  return { ok: true, status: 200 };
}

/** Create the workspace row on first use so loads never fail on a fresh database. */
async function ensureWorkspaceRow(db: SupabaseClient): Promise<void> {
  // Cheap single-row existence check — never a full workspace load.
  const { data } = await db.from("workspaces").select("id").eq("id", DEFAULT_WORKSPACE_ID).maybeSingle();
  if (!data) {
    await db.from("workspaces").upsert([
      { id: DEFAULT_WORKSPACE_ID, name: "Default workspace", format_version: 1, stencil_packs: [] },
    ]);
  }
}

/** Load the workspace, creating the default row on first use. */
async function loadWorkspace(adapter: SupabaseStorageAdapter, db: SupabaseClient): Promise<Workspace> {
  await ensureWorkspaceRow(db);
  return adapter.load();
}

/** Load the workspace plus its storage revision, creating the default row on first use. */
async function loadWorkspaceWithRevision(
  adapter: SupabaseStorageAdapter,
  db: SupabaseClient,
): Promise<{ workspace: Workspace; revision: number }> {
  await ensureWorkspaceRow(db);
  return adapter.loadWithRevision();
}

/**
 * Test-only injection seam: the contract-test suite swaps this in to run the
 * router against an in-memory fake instead of the network. Production code
 * never touches it — it stays `undefined` and `makeSupabaseClient` always
 * takes the `createClient` branch below, so runtime behaviour is unchanged.
 */
let supabaseClientFactory: ((env: Env) => SupabaseClient) | undefined;

/** @internal Test-only — replace (or clear, with `undefined`) the Supabase client factory. */
export function __setSupabaseClientFactory(factory: ((env: Env) => SupabaseClient) | undefined): void {
  supabaseClientFactory = factory;
}

function makeSupabaseClient(env: Env, serviceRoleKey: string): SupabaseClient {
  if (supabaseClientFactory) return supabaseClientFactory(env);
  // Every database request gets a hard timeout: a saturated pool must fail
  // fast (bounded function lifetime), never hang holding connections open.
  return createClient(SUPABASE_URL, serviceRoleKey, {
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
    },
  });
}

type Mutator = (ws: Workspace, bus: CommandBus, nextId: () => Ulid) => unknown;

/** Cost entries may arrive without ids (per the OpenAPI contract) — assign them server-side. */
const withCostIds = (costs: CostEntry[], nextId: () => Ulid): CostEntry[] =>
  costs.map((c) => (c.id ? c : { ...c, id: nextId() }));

/**
 * Public entry point: assigns a request id, times the request, and always
 * emits exactly one structured completion log line — success, client error,
 * or the catch-all 500 — before returning. The actual routing lives in
 * `handleRequest` below; this wrapper's `finally` is what guarantees the log
 * line fires on every return path, including ones that throw past
 * `handleRequest`'s own try/catch.
 */
export async function onRequest(context: Ctx): Promise<Response> {
  const reqId = crypto.randomUUID();
  const start = Date.now();
  const path = context.params.path ?? [];
  const method = context.request.method.toUpperCase();
  let status = 500;
  try {
    const response = await handleRequest(context, reqId);
    status = response.status;
    return response;
  } finally {
    const ms = Date.now() - start;
    console.log(JSON.stringify({ reqId, method, path: path.join("/"), status, ms }));
  }
}

async function handleRequest(context: Ctx, reqId: string): Promise<Response> {
  const { request, env } = context;
  const path = context.params.path ?? [];
  const method = request.method.toUpperCase();

  // Every response from here on carries the request id, so a client (or a
  // support conversation) can correlate a response with the server-side log
  // line `onRequest` just emitted for it.
  const json = (status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response =>
    jsonBase(status, body, { "x-request-id": reqId, ...extraHeaders });
  const err = (status: number, message: string): Response => json(status, { error: message });
  const reqHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    "x-request-id": reqId,
    ...extra,
  });

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: reqHeaders({
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
        "access-control-allow-headers": "*",
      }),
    });
  }

  // Best-effort in-isolate rate limit, keyed by a hash of the caller's token
  // (or a shared "anonymous" bucket when none is presented) — see
  // `../ratelimit.ts` for why this is a per-POP dampener, not a global cap.
  // The real backstop is a Cloudflare dashboard rate-limiting rule; see
  // docs/api.md.
  const tokenForRateLimit = extractToken(request) || "anonymous";
  const rateLimit = checkRateLimit(
    `api:${await hashToken(tokenForRateLimit)}`,
    rateLimitFromEnv(env.ATLAS_RATE_LIMIT_API, DEFAULT_API_RATE_LIMIT),
  );
  if (rateLimit.limited) {
    return json(
      429,
      { error: "Rate limit exceeded — try again shortly" },
      { "retry-after": String(rateLimit.retryAfterSeconds) },
    );
  }

  // Public: the machine-readable contract.
  if (path[0] === "openapi.json" && method === "GET") return json(200, openapiSpec);

  const auth = await authorised(request, env);
  if (!auth.ok) return err(auth.status, auth.message ?? "Unauthorised");
  if (auth.readOnly && MUTATING_METHODS.has(method)) {
    return err(403, "This token is read-only");
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return err(503, "API not configured: SUPABASE_SERVICE_ROLE_KEY secret is unset");
  }

  const workspaceId =
    new URL(request.url).searchParams.get("workspace_id") ?? DEFAULT_WORKSPACE_ID;
  const db = makeSupabaseClient(env, env.SUPABASE_SERVICE_ROLE_KEY);
  const adapter = new SupabaseStorageAdapter(db, workspaceId);

  const body = async <T>(): Promise<T> => (await request.json()) as T;

  /**
   * Run a mutation through the command bus and persist with an optimistic
   * revision guard. On a concurrent-write conflict the mutation re-runs
   * against fresh state (up to 3 attempts) — commands are revalidated each
   * time, so retries stay correct. 400s carry the validation message.
   */
  const mutate = async (fn: Mutator, opts: { successStatus?: number } = {}): Promise<Response> => {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) {
        // Jittered backoff so a burst of writers spreads out instead of
        // re-colliding in lockstep.
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.random() * 150));
      }
      await ensureWorkspaceRow(db);
      const { workspace: ws, revision } = await adapter.loadWithRevision();
      // Same stencil validation as the UI's bus — API writes must not be the
      // path that sneaks malformed stencil refs/attributes into the model.
      const bus = new CommandBus(ws, { stencils: stencilRegistry });
      const ids = ulidFactory();
      let result: unknown;
      try {
        result = fn(ws, bus, () => ids.next());
      } catch (e) {
        return err(400, e instanceof Error ? e.message : String(e));
      }
      try {
        await adapter.saveSnapshot(ws, { expectedRevision: revision });
      } catch (e) {
        if (e instanceof RevisionConflictError) continue;
        throw e;
      }
      // The save above succeeded with expectedRevision === revision, and
      // atlas_save_workspace always increments by exactly one per successful
      // call (see packages/storage-supabase/schema.sql) — so the new
      // revision is knowable here without an extra round-trip.
      const revisionHeaders = { "x-atlas-revision": String(revision + 1) };
      if (result === undefined) {
        // 204 responses must not carry a body.
        return new Response(null, {
          status: 204,
          headers: reqHeaders({ "access-control-allow-origin": "*", ...revisionHeaders }),
        });
      }
      return json(opts.successStatus ?? (method === "POST" ? 201 : 200), result, revisionHeaders);
    }
    return err(409, "Workspace is being modified concurrently — try again");
  };

  const resolveByName = (ws: Workspace, name: string): Element => {
    const matches = [...ws.elements.values()].filter(
      (e) => e.name.toLowerCase() === name.toLowerCase(),
    );
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0 ? `No element named "${name}"` : `Element name "${name}" is ambiguous`,
      );
    }
    return matches[0]!;
  };

  try {
    const [resource, id, sub, subId] = path;

    // ---- workspace ------------------------------------------------------
    // GET/HEAD carry an ETag (`"r<revision>"`) and `x-atlas-revision` for
    // cheap polling: a client that already has the current revision sends
    // `If-None-Match` and gets a bodyless 304 back instead of the whole
    // snapshot.
    if ((resource === undefined || resource === "workspace") && (method === "GET" || method === "HEAD")) {
      const { workspace: ws, revision } = await loadWorkspaceWithRevision(adapter, db);
      const etag = etagFor(revision);
      const headers = reqHeaders({
        "access-control-allow-origin": "*",
        etag,
        "x-atlas-revision": String(revision),
      });
      if (isNotModified(request, etag)) {
        return new Response(null, { status: 304, headers });
      }
      if (method === "HEAD") {
        return new Response(null, { status: 200, headers: { ...headers, "content-type": "application/json" } });
      }
      return json(200, ws.toData(), headers);
    }

    // POST /workspace: atomic bulk import/restore — replace the entire
    // stored workspace with the given snapshot (the exact shape GET
    // /workspace returns). Validation is dispatch-free: construct + check
    // integrity + re-validate stencil refs, same checks the command bus
    // would eventually hit, without replaying every command.
    if ((resource === undefined || resource === "workspace") && method === "POST") {
      const data = await body<WorkspaceData>();
      let imported: Workspace;
      try {
        imported = Workspace.fromData(data);
        checkIntegrity(imported);
        const stencilIssues: string[] = [];
        for (const el of imported.elements.values()) {
          if (!el.stencil) continue;
          for (const issue of stencilRegistry.validateRef(el.stencil)) {
            stencilIssues.push(`Element "${el.name}": ${issue}`);
          }
        }
        if (stencilIssues.length) throw new Error(stencilIssues.join("; "));
      } catch (e) {
        // checkIntegrity's WorkspaceLoadError carries the actual per-object
        // problems in `.issues` — its own `.message` is just a count.
        if (e instanceof WorkspaceLoadError && e.issues.length) {
          return err(400, `${e.message}: ${e.issues.join("; ")}`);
        }
        return err(400, e instanceof Error ? e.message : String(e));
      }

      if (new URL(request.url).searchParams.get("dryRun") === "1") {
        return json(200, { valid: true });
      }

      return mutate(
        (ws) => {
          ws.meta = imported.meta;
          ws.elements.clear();
          for (const [elId, el] of imported.elements) ws.elements.set(elId, el);
          ws.relationships.clear();
          for (const [relId, r] of imported.relationships) ws.relationships.set(relId, r);
          ws.views.clear();
          for (const [viewId, v] of imported.views) ws.views.set(viewId, v);
          ws.states.clear();
          for (const [stateId, s] of imported.states) ws.states.set(stateId, s);
          return ws.toData();
        },
        { successStatus: 200 },
      );
    }

    // ---- lint (read-side analysis) --------------------------------------
    if (resource === "lint" && method === "GET") {
      const ws = await loadWorkspace(adapter, db);
      return json(200, lintWorkspace(ws));
    }

    // ---- commands schema (read-side; must precede the POST /commands check
    //      only in the sense that it's a distinct method+path, order-agnostic) --
    if (resource === "commands" && id === "schema" && method === "GET") {
      return json(200, commandSchemas);
    }

    // ---- elements -------------------------------------------------------
    if (resource === "elements") {
      if (method === "GET" && id === undefined) {
        const ws = await loadWorkspace(adapter, db);
        const name = new URL(request.url).searchParams.get("name");
        const items = ws.toData().elements.filter(
          (e) => !name || e.name.toLowerCase() === name.toLowerCase(),
        );
        return json(200, items);
      }
      if (method === "GET" && id && sub === "connections") {
        const ws = await loadWorkspace(adapter, db);
        if (!ws.elements.has(id)) return err(404, `No element ${id}`);

        const params = new URL(request.url).searchParams;
        const depthParam = params.get("depth");
        let depth = 1;
        if (depthParam !== null) {
          depth = Number(depthParam);
          if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
            return err(400, "depth must be an integer between 1 and 3");
          }
        }
        const directionParam = params.get("direction") ?? "both";
        if (directionParam !== "both" && directionParam !== "out" && directionParam !== "in") {
          return err(400, `Unknown direction "${directionParam}" — expected both, out or in`);
        }
        const direction = directionParam as DirectionFilter;

        const network = egoNetwork(ws, id, { depth, direction });
        const nodes = [...network.elements].map(([elId, hop]) => {
          const el = ws.element(elId);
          return { id: el.id, kind: el.kind, name: el.name, hop };
        });
        return json(200, { center: id, nodes, edges: network.relationships });
      }
      if (method === "GET" && id && sub === undefined) {
        const ws = await loadWorkspace(adapter, db);
        const el = ws.elements.get(id);
        return el ? json(200, el) : err(404, `No element ${id}`);
      }
      if (method === "POST") {
        const input = await body<Partial<Element> & { parentName?: string }>();
        return mutate((ws, bus, nextId) => {
          if (!input.kind || !input.name) throw new Error("kind and name are required");
          const parentId =
            input.parentId ?? (input.parentName ? resolveByName(ws, input.parentName).id : null);
          const { parentName: _ignored, ...rest } = input;
          const element = { ...rest, id: nextId(), kind: input.kind, name: input.name, parentId } as Element;
          if (element.costs) element.costs = withCostIds(element.costs, nextId);
          bus.dispatch({ type: "createElement", element });
          return element;
        });
      }
      if (method === "PATCH" && id) {
        const changes = await body<Partial<Element>>();
        return mutate((ws, bus, nextId) => {
          if (changes.costs) changes.costs = withCostIds(changes.costs, nextId);
          bus.dispatch({ type: "updateElement", id, changes: changes as never });
          return ws.element(id);
        });
      }
      if (method === "DELETE" && id) {
        return mutate((_ws, bus) => {
          bus.dispatch({ type: "deleteElement", id });
        });
      }
    }

    // ---- relationships --------------------------------------------------
    if (resource === "relationships") {
      if (method === "GET" && id === undefined) {
        const ws = await loadWorkspace(adapter, db);
        return json(200, ws.toData().relationships);
      }
      if (method === "GET" && id) {
        const ws = await loadWorkspace(adapter, db);
        const rel = ws.relationships.get(id);
        return rel ? json(200, rel) : err(404, `No relationship ${id}`);
      }
      if (method === "POST") {
        const input = await body<Partial<Relationship> & { sourceName?: string; targetName?: string }>();
        return mutate((ws, bus, nextId) => {
          const sourceId =
            input.sourceId ?? (input.sourceName ? resolveByName(ws, input.sourceName).id : undefined);
          const targetId =
            input.targetId ?? (input.targetName ? resolveByName(ws, input.targetName).id : undefined);
          if (!sourceId || !targetId) throw new Error("sourceId/sourceName and targetId/targetName are required");
          const { sourceName: _s, targetName: _t, ...rest } = input;
          const relationship = { ...rest, id: nextId(), sourceId, targetId } as Relationship;
          bus.dispatch({ type: "createRelationship", relationship });
          return relationship;
        });
      }
      if (method === "PATCH" && id) {
        const changes = await body<Partial<Relationship>>();
        return mutate((ws, bus) => {
          bus.dispatch({ type: "updateRelationship", id, changes: changes as never });
          return ws.relationship(id);
        });
      }
      if (method === "DELETE" && id) {
        return mutate((_ws, bus) => {
          bus.dispatch({ type: "deleteRelationship", id });
        });
      }
    }

    // ---- views and placements ------------------------------------------
    if (resource === "views") {
      if (method === "GET" && id === undefined) {
        const ws = await loadWorkspace(adapter, db);
        return json(200, ws.toData().views);
      }
      if (method === "GET" && id && sub === "export") {
        const ws = await loadWorkspace(adapter, db);
        if (!ws.views.has(id)) return err(404, `No view ${id}`);
        const format = new URL(request.url).searchParams.get("format");
        const headers = reqHeaders({ "access-control-allow-origin": "*" });
        if (format === "mermaid") {
          return new Response(toMermaidC4(ws, id), { status: 200, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
        }
        if (format === "plantuml") {
          return new Response(toPlantUmlC4(ws, id), { status: 200, headers: { ...headers, "content-type": "text/plain; charset=utf-8" } });
        }
        if (format === "svg") {
          return new Response(toSvg(ws, id), { status: 200, headers: { ...headers, "content-type": "image/svg+xml" } });
        }
        return err(400, `Unknown format "${format}" — expected mermaid, plantuml or svg`);
      }
      if (method === "GET" && id && sub === undefined) {
        const ws = await loadWorkspace(adapter, db);
        const view = ws.views.get(id);
        return view ? json(200, view) : err(404, `No view ${id}`);
      }
      if (method === "POST" && id === undefined) {
        const input = await body<Partial<View>>();
        return mutate((_ws, bus, nextId) => {
          if (!input.kind || !input.name) throw new Error("kind and name are required");
          const view: View = {
            id: nextId(),
            kind: input.kind,
            name: input.name,
            scopeId: input.scopeId ?? null,
            placements: input.placements ?? [],
            ...(input.description ? { description: input.description } : {}),
            ...(input.renderMode ? { renderMode: input.renderMode } : {}),
          };
          bus.dispatch({ type: "createView", view });
          return view;
        });
      }
      if (method === "PATCH" && id && sub === undefined) {
        const changes = await body<Partial<View>>();
        return mutate((ws, bus) => {
          bus.dispatch({ type: "updateView", id, changes: changes as never });
          return ws.view(id);
        });
      }
      if (method === "DELETE" && id && sub === undefined) {
        return mutate((_ws, bus) => {
          bus.dispatch({ type: "deleteView", id });
        });
      }
      if (id && sub === "placements") {
        if (method === "POST") {
          const input = await body<{ elementId?: Ulid; elementName?: string; x?: number; y?: number; width?: number; height?: number }>();
          return mutate((ws, bus) => {
            const elementId =
              input.elementId ?? (input.elementName ? resolveByName(ws, input.elementName).id : undefined);
            if (!elementId) throw new Error("elementId or elementName is required");
            const placement = {
              elementId,
              x: input.x ?? 0,
              y: input.y ?? 0,
              ...(input.width ? { width: input.width } : {}),
              ...(input.height ? { height: input.height } : {}),
            };
            bus.dispatch({ type: "placeOnView", viewId: id, placement });
            return placement;
          });
        }
        if (method === "PATCH" && subId) {
          const changes = await body<{ x?: number; y?: number; width?: number; height?: number }>();
          return mutate((ws, bus) => {
            bus.dispatch({ type: "updatePlacement", viewId: id, elementId: subId, changes });
            return ws.view(id).placements.find((p) => p.elementId === subId);
          });
        }
        if (method === "DELETE" && subId) {
          return mutate((_ws, bus) => {
            bus.dispatch({ type: "removeFromView", viewId: id, elementId: subId });
          });
        }
      }
    }

    // ---- states ---------------------------------------------------------
    if (resource === "states") {
      if (method === "GET") {
        const ws = await loadWorkspace(adapter, db);
        return json(200, ws.toData().states);
      }
      if (method === "POST") {
        const input = await body<Partial<NamedState>>();
        return mutate((_ws, bus, nextId) => {
          if (!input.name) throw new Error("name is required");
          const state: NamedState = {
            id: nextId(),
            name: input.name,
            ...(input.date ? { date: input.date } : {}),
            ...(input.description ? { description: input.description } : {}),
          };
          bus.dispatch({ type: "createState", state });
          return state;
        });
      }
      if (method === "PATCH" && id) {
        const changes = await body<Partial<NamedState>>();
        return mutate((ws, bus) => {
          bus.dispatch({ type: "updateState", id, changes: changes as never });
          return ws.state(id);
        });
      }
      if (method === "DELETE" && id) {
        return mutate((_ws, bus) => {
          bus.dispatch({ type: "deleteState", id });
        });
      }
    }

    // ---- raw commands (full power, same bus) ----------------------------
    if (resource === "commands" && method === "POST") {
      const input = await body<{ commands: Command[]; label?: string }>();
      if (!Array.isArray(input.commands) || input.commands.length === 0) {
        return err(400, "commands must be a non-empty array");
      }
      return mutate((ws, bus) => {
        bus.dispatch({ type: "batch", label: input.label ?? "API batch", commands: input.commands });
        return ws.toData();
      });
    }

    return err(404, `No route for ${method} /api/v1/${path.join("/")}`);
  } catch (e) {
    // Full detail (message + stack) is server-side only — the client gets a
    // generic message plus the request id to quote back if they report it.
    // (400s elsewhere are deliberately verbatim: those are intentional,
    // client-facing validation messages, not internal failures.)
    console.error(JSON.stringify({ reqId, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined }));
    return err(500, `Internal error — quote request id ${reqId} if you report this`);
  }
}
