/**
 * Contract tests for the operational surface added on top of the model API
 * router and the AI proxy: request ids, the 500 catch-all's error-hiding
 * behaviour, the read-only token tier, and the shared fixed-window rate
 * limiter (`functions/api/ratelimit.ts`).
 *
 * Rate-limiter determinism: the limiter's clock is injectable
 * (`__setClock`) and its state is reset (`__resetRateLimits`) before every
 * test in this file, so window rollover is driven by fake timestamps —
 * never real sleeps.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { onRequest, __setSupabaseClientFactory } from "../functions/api/v1/[[path]]";
import { onRequestPost as anthropicPost } from "../functions/api/anthropic/v1/messages.js";
import { __resetRateLimits, __setClock } from "../functions/api/ratelimit";
import { FakeSupabase } from "./support/fake-supabase";

const TOKEN = "test-token";
const READONLY_TOKEN = "readonly-token";

function makeEnv(overrides: Record<string, string> = {}) {
  return {
    ATLAS_API_TOKEN: TOKEN,
    ATLAS_API_TOKEN_READONLY: READONLY_TOKEN,
    SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
    ...overrides,
  };
}

interface CallOptions {
  token?: string | null;
  body?: unknown;
  env?: Record<string, string>;
}

async function call(method: string, segments: string[], opts: CallOptions = {}): Promise<Response> {
  const url = new URL(`https://example.com/api/v1/${segments.join("/")}`);
  const token = opts.token === undefined ? TOKEN : opts.token;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return onRequest({ request, env: opts.env ?? makeEnv(), params: { path: segments } });
}

function anthropicRequest(token: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("https://example.com/api/anthropic/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "claude-sonnet", messages: [] }),
  });
}

let fake: FakeSupabase;

beforeEach(() => {
  fake = new FakeSupabase();
  __setSupabaseClientFactory(() => fake as unknown as SupabaseClient);
  // Every test starts with a clean limiter — no cross-test bleed of counts
  // (all router tests in this file share the same TOKEN, hence the same
  // rate-limit bucket) or of an injected clock left over from a prior test.
  __resetRateLimits();
  __setClock(undefined);
});

afterEach(() => {
  __setSupabaseClientFactory(undefined);
  __resetRateLimits();
  __setClock(undefined);
});

describe("request id", () => {
  it("is present on a success response", async () => {
    const res = await call("GET", ["elements"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("is present on an error response", async () => {
    const res = await call("GET", ["elements"], { token: null });
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("is present on a 204 (no-body) response", async () => {
    const created = await call("POST", ["elements"], { body: { kind: "system", name: "Req Id Probe" } });
    const created204 = (await created.json()) as { id: string };
    const res = await call("DELETE", ["elements", created204.id]);
    expect(res.status).toBe(204);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("500 catch-all hides internals", () => {
  it("logs the real error server-side but returns only a generic message + request id", async () => {
    const secret = "supabase-service-role-internal-detail-should-never-reach-the-client";
    const throwing = {
      from() {
        throw new Error(secret);
      },
    };
    __setSupabaseClientFactory(() => throwing as unknown as SupabaseClient);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const res = await call("GET", ["elements"]);
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).not.toContain(secret);
      expect(body.error).toContain(res.headers.get("x-request-id")!);

      // The real error made it to the server-side log, secret and all.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]![0])).toContain(secret);

      // And exactly one structured completion log line was emitted for the request.
      expect(logSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(String(logSpy.mock.calls[0]![0])) as { status: number; reqId: string };
      expect(logged.status).toBe(500);
      expect(logged.reqId).toBe(res.headers.get("x-request-id"));
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("still returns 400s verbatim (validation messages are intentional, not hidden)", async () => {
    const res = await call("POST", ["elements"], { body: { kind: "container", name: "Bad Container" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("cannot live");
  });
});

describe("read-only token tier", () => {
  it("GET succeeds with the read-only token", async () => {
    const res = await call("GET", ["elements"], { token: READONLY_TOKEN });
    expect(res.status).toBe(200);
  });

  it("HEAD succeeds with the read-only token", async () => {
    const res = await call("HEAD", ["workspace"], { token: READONLY_TOKEN });
    expect(res.status).toBe(200);
  });

  it("POST is rejected with 403 for the read-only token", async () => {
    const res = await call("POST", ["elements"], {
      token: READONLY_TOKEN,
      body: { kind: "system", name: "Should Not Be Created" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("This token is read-only");
  });

  it("PATCH and DELETE are also rejected with 403 for the read-only token", async () => {
    const created = await call("POST", ["elements"], { body: { kind: "system", name: "RO Target" } });
    const { id } = (await created.json()) as { id: string };

    const patched = await call("PATCH", ["elements", id], { token: READONLY_TOKEN, body: { name: "Nope" } });
    expect(patched.status).toBe(403);

    const deleted = await call("DELETE", ["elements", id], { token: READONLY_TOKEN });
    expect(deleted.status).toBe(403);
  });

  it("the AI proxy rejects the read-only token (401 or 403), never spending money on it", async () => {
    const res = await anthropicPost({
      request: anthropicRequest(READONLY_TOKEN),
      env: { ATLAS_API_TOKEN: TOKEN, ATLAS_API_TOKEN_READONLY: READONLY_TOKEN, ANTHROPIC_API_KEY: "unused" },
    });
    expect([401, 403]).toContain(res.status);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("rate limiting — model API", () => {
  it("429s once the configured per-minute limit is exceeded, then 200s again after the window resets", async () => {
    let now = 1_700_000_000_000;
    __setClock(() => now);
    const env = makeEnv({ ATLAS_RATE_LIMIT_API: "2" });

    const first = await call("GET", ["elements"], { env });
    expect(first.status).toBe(200);
    const second = await call("GET", ["elements"], { env });
    expect(second.status).toBe(200);

    const third = await call("GET", ["elements"], { env });
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await third.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("rate limit");

    // Still within the same window — still limited.
    const stillLimited = await call("GET", ["elements"], { env });
    expect(stillLimited.status).toBe(429);

    // Advance past the 60s fixed window — a fresh window, fresh quota.
    now += 60_001;
    const afterReset = await call("GET", ["elements"], { env });
    expect(afterReset.status).toBe(200);
  });

  it("a limit of 0 disables rate limiting entirely", async () => {
    let now = 1_700_000_000_000;
    __setClock(() => now);
    const env = makeEnv({ ATLAS_RATE_LIMIT_API: "0" });

    for (let i = 0; i < 10; i++) {
      const res = await call("GET", ["elements"], { env });
      expect(res.status).toBe(200);
    }
  });
});

describe("rate limiting — AI proxy", () => {
  // ANTHROPIC_API_KEY is deliberately unset: an under-limit request then
  // reaches the "not configured" branch (503) without ever making a real
  // network call to Anthropic — exactly the behaviour we want to observe
  // without touching the network.
  const envNoKey = { ATLAS_API_TOKEN: TOKEN, ATLAS_RATE_LIMIT_AI: "2" };

  it("429s once the configured per-minute limit is exceeded, then recovers after the window resets", async () => {
    let now = 1_800_000_000_000;
    __setClock(() => now);

    const first = await anthropicPost({ request: anthropicRequest(TOKEN), env: envNoKey });
    expect(first.status).toBe(503);
    const second = await anthropicPost({ request: anthropicRequest(TOKEN), env: envNoKey });
    expect(second.status).toBe(503);

    const third = await anthropicPost({ request: anthropicRequest(TOKEN), env: envNoKey });
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);

    now += 60_001;
    const afterReset = await anthropicPost({ request: anthropicRequest(TOKEN), env: envNoKey });
    expect(afterReset.status).toBe(503);
  });
});

describe("AI proxy parity with the model API", () => {
  it("responds to OPTIONS with CORS headers and no body", async () => {
    const { onRequestOptions } = await import("../functions/api/anthropic/v1/messages.js");
    const res = onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.text()).toBe("");
  });

  it("carries access-control-allow-origin on a normal response", async () => {
    const res = await anthropicPost({
      request: anthropicRequest(TOKEN),
      env: { ATLAS_API_TOKEN: TOKEN }, // no ANTHROPIC_API_KEY -> deterministic 503, no network
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns 504 when the upstream Anthropic call times out", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.anthropic.com")) {
        return Promise.reject(new DOMException("The operation timed out", "TimeoutError"));
      }
      return Promise.reject(new Error(`unexpected fetch in test: ${url}`));
    });
    try {
      const res = await anthropicPost({
        request: anthropicRequest(TOKEN),
        env: { ATLAS_API_TOKEN: TOKEN, ANTHROPIC_API_KEY: "fake-key-for-test" },
      });
      expect(res.status).toBe(504);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message.toLowerCase()).toContain("timed out");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
