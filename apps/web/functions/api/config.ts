/**
 * Shared constants for the Cloudflare Pages Functions under `functions/`.
 *
 * The Supabase project is public-anon-key-safe by design (RLS enforces
 * access) so it's fine to inline; this module exists purely to avoid the
 * same two literals drifting across the model API router and the AI proxy.
 * `apps/web/src/supabase.ts` keeps its own copy for the browser bundle —
 * intentionally not shared across the functions/src boundary.
 */

export const SUPABASE_URL = "https://gpklzsbyrvwgauvoolsx.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwa2x6c2J5cnZ3Z2F1dm9vbHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0Mzg5NTMsImV4cCI6MjEwMDAxNDk1M30.TFnrj83nzCVGidsnTnqW0m9VWFBxbm6V00ehvT_BH0U";
