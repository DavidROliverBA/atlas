/**
 * Token-secured AI proxy (Cloudflare Pages Function).
 *
 * POST /api/anthropic/v1/messages — same wire shape as the Anthropic
 * Messages API, so the browser SDK targets it via `baseURL`. Callers must
 * present a token in `x-api-key` (or `Authorization: Bearer`):
 *   - a Supabase session token from the GitHub SSO login, verified against
 *     Supabase Auth on every request, or
 *   - the static service token (ATLAS_API_TOKEN secret) for scripts/CI.
 * The real Anthropic key lives only in the ANTHROPIC_API_KEY secret —
 * end users never handle it. The read-only model-API token
 * (ATLAS_API_TOKEN_READONLY) is explicitly NOT accepted here — this route
 * spends real money on every call, so "read-only" callers get 403.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config";
import { checkRateLimit, hashToken, rateLimitFromEnv } from "../../ratelimit";

/** Requests/minute per token when env doesn't override it — see `../../ratelimit.ts`. */
const DEFAULT_AI_RATE_LIMIT = 20;

/** Upstream Anthropic calls can legitimately take a while for big generations, but must stay bounded. */
const UPSTREAM_TIMEOUT_MS = 55_000;

const CORS_HEADERS = { "access-control-allow-origin": "*" };

const json = (status, body, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "*",
    },
  });
}

export async function onRequestPost({ request, env }) {
  const reqId = crypto.randomUUID();
  const start = Date.now();
  let status = 500;
  try {
    const response = await handle(request, env, reqId);
    status = response.status;
    return response;
  } finally {
    const ms = Date.now() - start;
    console.log(JSON.stringify({ reqId, method: "POST", path: "anthropic/v1/messages", status, ms }));
  }
}

async function handle(request, env, reqId) {
  const withReqId = (body, status, extraHeaders = {}) => json(status, body, { "x-request-id": reqId, ...extraHeaders });

  const token =
    request.headers.get("x-api-key") ??
    (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return withReqId({ type: "error", error: { type: "authentication_error", message: "Missing token" } }, 401);
  }

  // The read-only model-API token spends no money and must never reach the
  // AI proxy, which does — reject it explicitly rather than letting it fall
  // through to the Supabase-session check below (which would also 401 it,
  // but with a message that doesn't explain why).
  if (env.ATLAS_API_TOKEN_READONLY && token === env.ATLAS_API_TOKEN_READONLY) {
    return withReqId(
      { type: "error", error: { type: "permission_error", message: "This token is read-only and cannot be used for the AI proxy" } },
      403,
    );
  }

  // Best-effort in-isolate rate limit, keyed by a hash of the caller's token —
  // see `../../ratelimit.ts` for why this is a per-POP dampener, not a global
  // cap. The real backstop is a Cloudflare dashboard rate-limiting rule; see
  // docs/api.md.
  const rateLimit = checkRateLimit(
    `ai:${await hashToken(token)}`,
    rateLimitFromEnv(env.ATLAS_RATE_LIMIT_AI, DEFAULT_AI_RATE_LIMIT),
  );
  if (rateLimit.limited) {
    return withReqId(
      { type: "error", error: { type: "rate_limit_error", message: "Rate limit exceeded — try again shortly" } },
      429,
      { "retry-after": String(rateLimit.retryAfterSeconds) },
    );
  }

  let authorised = Boolean(env.ATLAS_API_TOKEN) && token === env.ATLAS_API_TOKEN;
  if (!authorised) {
    // Validate as a Supabase session token (GitHub SSO).
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (who.ok) {
      // Optional allow-list: only named GitHub accounts may spend AI budget.
      const allowed = (env.ATLAS_ALLOWED_GITHUB ?? "")
        .split(",")
        .map((u) => u.trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length === 0) {
        authorised = true;
      } else {
        const user = await who.json();
        const username = (user.user_metadata?.user_name ?? "").toLowerCase();
        if (allowed.includes(username)) authorised = true;
        else {
          return withReqId(
            {
              type: "error",
              error: { type: "permission_error", message: "This GitHub account is not authorised to use the Atlas AI" },
            },
            403,
          );
        }
      }
    }
  }
  if (!authorised) {
    return withReqId(
      {
        type: "error",
        error: { type: "authentication_error", message: "Invalid token — sign in with GitHub or use the service token" },
      },
      401,
    );
  }

  if (!env.ANTHROPIC_API_KEY) {
    return withReqId(
      { type: "error", error: { type: "api_error", message: "AI proxy not configured: ANTHROPIC_API_KEY secret is unset" } },
      503,
    );
  }

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": request.headers.get("anthropic-version") ?? "2023-06-01",
      },
      body: request.body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return withReqId(
        { type: "error", error: { type: "timeout_error", message: "Upstream Anthropic request timed out" } },
        504,
      );
    }
    throw e;
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      ...CORS_HEADERS,
      "x-request-id": reqId,
    },
  });
}
