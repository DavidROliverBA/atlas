/**
 * Fixed-window in-memory rate limiter shared by the model API
 * (`api/v1/[[path]].ts`) and the AI proxy (`api/anthropic/v1/messages.js`).
 *
 * IMPORTANT — this is a best-effort, per-isolate throttle, NOT a global rate
 * limit. Cloudflare Pages Functions run in many isolates across many points
 * of presence, each with its own copy of the `windows` map below, and an
 * isolate can be evicted/recycled at any time (dropping its counters). A
 * caller hammering the API from two different POPs (or hitting a freshly
 * spun-up isolate) can exceed the configured limit in practice. Treat this
 * tier as cheap abuse-dampening, not a guarantee — the real backstop is a
 * Cloudflare dashboard rate-limiting rule in front of these routes (see
 * docs/api.md's Authentication section for the one-liner).
 */

const WINDOW_MS = 60_000;

interface WindowState {
  windowStart: number;
  count: number;
}

/** Per-isolate state — see the module-doc caveat above. */
const windows = new Map<string, WindowState>();

/** Injectable clock so tests can drive window rollover without sleeping. */
let clock: () => number = () => Date.now();

/** @internal Test-only — replace the clock (or reset to `Date.now`, with `undefined`). */
export function __setClock(fn: (() => number) | undefined): void {
  clock = fn ?? (() => Date.now());
}

/** @internal Test-only — clear all limiter state between tests. */
export function __resetRateLimits(): void {
  windows.clear();
}

export interface RateLimitResult {
  limited: boolean;
  /** Seconds until the current window rolls over — meaningful only when `limited`. */
  retryAfterSeconds: number;
}

/**
 * Check-and-increment `key` against a fixed `limit`-per-minute window.
 * `limit <= 0` (or non-finite) disables limiting entirely for that key —
 * used to turn a tier off via env for local dev / deterministic tests that
 * don't care about it.
 */
export function checkRateLimit(key: string, limit: number): RateLimitResult {
  if (!Number.isFinite(limit) || limit <= 0) return { limited: false, retryAfterSeconds: 0 };

  const now = clock();
  const existing = windows.get(key);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    windows.set(key, { windowStart: now, count: 1 });
    return { limited: false, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStart + WINDOW_MS - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

/** SHA-256 hex digest of `token`, truncated to 12 chars — enough to bucket callers without storing the raw token. */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 12);
}

/** Parse a rate-limit env var (string, as Cloudflare passes it) with a fallback; `"0"` disables. */
export function rateLimitFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
