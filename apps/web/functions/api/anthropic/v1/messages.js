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
 * end users never handle it.
 */

const SUPABASE_URL = "https://cbimxxazmoujtetkrpvk.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNiaW14eGF6bW91anRldGtycHZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNDczODAsImV4cCI6MjA5OTkyMzM4MH0.S5yAEtC6qCzr1IyX_noTbGr3Bas8cO-oTPzz7tWVJ58";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export async function onRequestPost({ request, env }) {
  const token =
    request.headers.get("x-api-key") ??
    (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) {
    return json(401, { type: "error", error: { type: "authentication_error", message: "Missing token" } });
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
          return json(403, {
            type: "error",
            error: { type: "permission_error", message: "This GitHub account is not authorised to use the Atlas AI" },
          });
        }
      }
    }
  }
  if (!authorised) {
    return json(401, {
      type: "error",
      error: { type: "authentication_error", message: "Invalid token — sign in with GitHub or use the service token" },
    });
  }

  if (!env.ANTHROPIC_API_KEY) {
    return json(503, {
      type: "error",
      error: { type: "api_error", message: "AI proxy not configured: ANTHROPIC_API_KEY secret is unset" },
    });
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": request.headers.get("anthropic-version") ?? "2023-06-01",
    },
    body: request.body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
